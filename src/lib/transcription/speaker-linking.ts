/**
 * Links Gemini's speaker labels ("Speaker 1") to the diarization voice
 * fingerprint clusters ("SPEAKER_00") by TIME OVERLAP, not by numbering order.
 *
 * Gemini numbers speakers however it likes; the pyannote pre-pass numbers voice
 * clusters however it likes. The only reliable bridge is the shared clock: for
 * each Gemini speaker, whichever fingerprint cluster was talking during the same
 * moments is the same person. All functions here are pure and unit-tested.
 */

export interface DiarizeSegmentLite {
    start: number;
    end: number;
    speaker: string;
}

export interface GeminiTurn {
    label: string; // e.g. "Speaker 2"
    start: number; // seconds
    end: number; // seconds (next turn's start, or audio end)
}

/**
 * Parse `[m:ss] Speaker N: text` (or `[h:mm:ss]`) lines into turns with a
 * time range. Each turn runs from its timestamp to the next turn's timestamp;
 * the final turn runs to `audioDuration` (or its own start if unknown).
 * Returns [] if no timestamped speaker lines are found.
 */
export function parseTimestampedTurns(
    text: string,
    audioDuration?: number,
): GeminiTurn[] {
    const re = /^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(Speaker\s+\d+)\s*:/gim;
    const marks: { label: string; start: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        const c = m[3] !== undefined ? Number(m[3]) : undefined;
        // [h:mm:ss] when three groups present, else [m:ss].
        const start = c !== undefined ? a * 3600 + b * 60 + c : a * 60 + b;
        marks.push({ label: m[4].replace(/\s+/g, " ").trim(), start });
    }
    if (marks.length === 0) return [];

    const turns: GeminiTurn[] = [];
    for (let i = 0; i < marks.length; i++) {
        const start = marks[i].start;
        const end =
            i + 1 < marks.length
                ? marks[i + 1].start
                : (audioDuration ?? start);
        turns.push({ label: marks[i].label, start, end: Math.max(end, start) });
    }
    return turns;
}

/**
 * Map each Gemini speaker label to the diarization cluster it overlaps most in
 * time. Returns { geminiLabel -> diarizeLabel }. A diarize cluster is assigned
 * to at most one Gemini label (its strongest), so two Gemini speakers can't
 * collapse onto the same voice.
 */
export function linkSpeakersByOverlap(
    turns: GeminiTurn[],
    segments: DiarizeSegmentLite[],
): Record<string, string> {
    // overlap[geminiLabel][diarizeLabel] = total overlapping seconds
    const overlap: Record<string, Record<string, number>> = {};
    for (const turn of turns) {
        for (const seg of segments) {
            const lo = Math.max(turn.start, seg.start);
            const hi = Math.min(turn.end, seg.end);
            const ov = hi - lo;
            if (ov <= 0) continue;
            (overlap[turn.label] ??= {})[seg.speaker] =
                (overlap[turn.label][seg.speaker] ?? 0) + ov;
        }
    }

    // Greedy assignment: strongest (gemini, diarize) pairs first, each diarize
    // cluster used once.
    const pairs: { g: string; d: string; ov: number }[] = [];
    for (const [g, byD] of Object.entries(overlap)) {
        for (const [d, ov] of Object.entries(byD)) {
            pairs.push({ g, d, ov });
        }
    }
    pairs.sort((x, y) => y.ov - x.ov);

    const result: Record<string, string> = {};
    const usedDiarize = new Set<string>();
    const assignedGemini = new Set<string>();
    for (const { g, d, ov } of pairs) {
        if (ov <= 0) continue;
        if (assignedGemini.has(g) || usedDiarize.has(d)) continue;
        result[g] = d;
        assignedGemini.add(g);
        usedDiarize.add(d);
    }
    return result;
}

/**
 * Re-key a diarize-labelled map (SPEAKER_NN -> value) onto Gemini labels using
 * a { geminiLabel -> diarizeLabel } link. Only entries whose diarize label was
 * linked are carried over. Values are passed through untouched.
 */
export function rekeyByLink<T>(
    byDiarizeLabel: Record<string, T>,
    link: Record<string, string>,
): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [geminiLabel, diarizeLabel] of Object.entries(link)) {
        const v = byDiarizeLabel[diarizeLabel];
        if (v !== undefined) out[geminiLabel] = v;
    }
    return out;
}

/** Remove leading `[m:ss] ` / `[h:mm:ss] ` timestamps from every line. */
export function stripTimestamps(text: string): string {
    return text.replace(/^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/gim, "");
}
