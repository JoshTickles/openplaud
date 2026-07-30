/**
 * Cross-recording speaker identity matching.
 *
 * Diarization produces an L2-normalised centroid embedding per speaker in a
 * recording. Matching those against a user's saved voiceprint library lets us
 * suggest real names ("Speaker 1 is probably Indy") without the user
 * re-labelling every meeting. Naming a speaker enrols/updates their voiceprint.
 *
 * All functions here are pure (no I/O) so they're trivially testable.
 */

export interface Voiceprint {
    name: string;
    embedding: number[];
    sampleCount: number;
}

export interface SpeakerMatch {
    /** Best-matching known name, or null if nothing cleared the threshold. */
    name: string | null;
    /** Cosine similarity of the best match (0..1 for normalised, same-sign vecs). */
    similarity: number;
}

/**
 * Cosine similarity of two equal-length vectors. Returns 0 for a length
 * mismatch or a zero-magnitude vector rather than throwing, so a stray
 * malformed embedding can't break a whole transcription.
 */
export function cosineSim(a: number[], b: number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Default cosine threshold for a confident same-speaker match. wespeaker
 * embeddings for the same person typically sit well above this; different
 * people sit far below (observed ~0.1-0.35 on real meeting audio).
 */
export const DEFAULT_MATCH_THRESHOLD = 0.5;

/**
 * For each speaker centroid, find the best-matching voiceprint above
 * `threshold`. A given known name is assigned to at most one speaker (its
 * best), so two speakers can't both be suggested as the same person.
 *
 * @param centroids   speakerLabel -> centroid embedding (from diarization)
 * @param library     the user's saved voiceprints
 * @returns speakerLabel -> SpeakerMatch (name null when nothing matched)
 */
export function matchSpeakers(
    centroids: Record<string, number[]>,
    library: Voiceprint[],
    threshold: number = DEFAULT_MATCH_THRESHOLD,
): Record<string, SpeakerMatch> {
    const labels = Object.keys(centroids);
    const result: Record<string, SpeakerMatch> = {};
    for (const label of labels) {
        result[label] = { name: null, similarity: 0 };
    }
    if (library.length === 0) return result;

    // Score every (speaker, voiceprint) pair, then greedily assign highest
    // similarities first so each name lands on its single best speaker.
    const pairs: { label: string; name: string; sim: number }[] = [];
    for (const label of labels) {
        for (const vp of library) {
            pairs.push({
                label,
                name: vp.name,
                sim: cosineSim(centroids[label], vp.embedding),
            });
        }
    }
    pairs.sort((x, y) => y.sim - x.sim);

    const usedNames = new Set<string>();
    const assignedLabels = new Set<string>();
    for (const { label, name, sim } of pairs) {
        if (sim < threshold) break;
        if (usedNames.has(name) || assignedLabels.has(label)) continue;
        result[label] = { name, similarity: sim };
        usedNames.add(name);
        assignedLabels.add(label);
    }
    return result;
}

/**
 * Fold a newly-confirmed centroid into an existing voiceprint via a
 * sample-count-weighted running average, then re-normalise. This sharpens a
 * person's voiceprint over many meetings and resists a single noisy sample.
 * Returns the new embedding and incremented sample count.
 */
export function mergeVoiceprint(
    existing: Voiceprint,
    newEmbedding: number[],
): { embedding: number[]; sampleCount: number } {
    if (newEmbedding.length !== existing.embedding.length) {
        // Dimension changed (e.g. model swap) — trust the new sample.
        return { embedding: normalize(newEmbedding), sampleCount: 1 };
    }
    const n = existing.sampleCount;
    const merged = existing.embedding.map(
        (v, i) => (v * n + newEmbedding[i]) / (n + 1),
    );
    return { embedding: normalize(merged), sampleCount: n + 1 };
}

/**
 * Resolve a transcript speaker label ("Speaker 1") to its diarization centroid.
 *
 * Centroids are keyed by diarize labels ("SPEAKER_00"), but transcripts use
 * "Speaker 1, 2, 3...". formatDiarizeHint() maps sorted SPEAKER_NN keys onto
 * "Speaker 1, 2, 3..." in order, so we invert that: the Nth sorted centroid
 * key is "Speaker N". Falls back to a direct key match when the label is
 * already a diarize label. Returns undefined when nothing resolves.
 *
 * This is the seam between the transcript and diarization label namespaces;
 * getting it wrong silently breaks voiceprint enrollment, so it's isolated
 * here and unit-tested directly.
 */
export function centroidForTranscriptLabel(
    label: string,
    centroids: Record<string, number[]>,
): number[] | undefined {
    const sortedKeys = Object.keys(centroids).sort();
    const m = label.match(/^speaker\s*(\d+)$/i);
    if (m) {
        const idx = Number(m[1]) - 1;
        if (idx >= 0 && idx < sortedKeys.length) {
            return centroids[sortedKeys[idx]];
        }
    }
    return centroids[label];
}

/** L2-normalise a vector (no-op safety on zero magnitude). */
export function normalize(v: number[]): number[] {
    let mag = 0;
    for (const x of v) mag += x * x;
    mag = Math.sqrt(mag);
    if (mag < 1e-9) return v.slice();
    return v.map((x) => x / mag);
}
