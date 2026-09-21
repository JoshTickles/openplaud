/**
 * Turns a timestamped transcript into per-speaker voiceprints, and uses those
 * voiceprints to repair the transcript's own speaker labels.
 *
 * The model transcribes unaided, so it sometimes splits one person across two
 * labels. Rather than pay for full-file diarization to prevent that, we sample
 * a bounded amount of audio per emitted label, embed it, and compare the labels
 * against each other: two labels that are really the same person sit far above
 * the similarity threshold, genuinely different people sit far below it.
 *
 * Everything here is pure. The audio work lives in `scripts/embed-speaker-turns.py`.
 */

import {
    averageEmbeddings,
    cosineSim,
    normalize,
} from "@/lib/transcription/voiceprint-match";
import type { GeminiTurn } from "@/lib/transcription/speaker-linking";

/** Length of every embedding window. Fixed so the ONNX model always sees the
 * same input shape, which is what stops it leaking memory per call. */
export const WINDOW_SECONDS = 3;
/** How much audio to gather per speaker. Enough for a stable centroid without
 * embedding the whole recording. */
export const TARGET_SECONDS_PER_SPEAKER = 18;
/** Trimmed off each end of a turn so an approximate timestamp can't clip into
 * the neighbouring voice. */
export const EDGE_TRIM_SECONDS = 0.5;
/**
 * Above this cosine similarity, two labels are the same person. Distinct
 * speakers in one recording measure 0.13-0.35; the same person across different
 * recordings measures ~0.91, so anything in this range separates them cleanly.
 */
export const DEFAULT_MERGE_SIMILARITY = 0.6;

export interface SampleWindowOptions {
    windowSeconds?: number;
    targetSecondsPerSpeaker?: number;
    edgeTrimSeconds?: number;
}

/**
 * Choose window start times per speaker label, spread across that speaker's
 * turns rather than taken from one long monologue.
 *
 * Turns are visited longest-first in repeated passes, each pass taking the next
 * window from each turn, so a speaker with many turns is sampled at many
 * different moments. Turns too short to hold a full window are skipped, which
 * means a speaker who only ever interjects gets no voiceprint.
 */
export function selectSampleWindows(
    turns: GeminiTurn[],
    options: SampleWindowOptions = {},
): Record<string, number[]> {
    const windowSeconds = options.windowSeconds ?? WINDOW_SECONDS;
    const targetSeconds =
        options.targetSecondsPerSpeaker ?? TARGET_SECONDS_PER_SPEAKER;
    const trim = options.edgeTrimSeconds ?? EDGE_TRIM_SECONDS;
    const maxWindows = Math.max(1, Math.ceil(targetSeconds / windowSeconds));

    const byLabel = new Map<string, GeminiTurn[]>();
    for (const turn of turns) {
        const list = byLabel.get(turn.label);
        if (list) list.push(turn);
        else byLabel.set(turn.label, [turn]);
    }

    const result: Record<string, number[]> = {};
    for (const [label, labelTurns] of byLabel) {
        // Trim both ends where the turn is long enough to afford it; a turn only
        // just wide enough for a window is used untrimmed rather than dropped.
        const spans = labelTurns
            .map((t) => {
                const trimmable = t.end - t.start >= windowSeconds + 2 * trim;
                const lo = trimmable ? t.start + trim : t.start;
                const hi = trimmable ? t.end - trim : t.end;
                return { lo, hi, span: hi - lo };
            })
            .filter((s) => s.span >= windowSeconds)
            .sort((a, b) => b.span - a.span);

        const starts: number[] = [];
        for (let pass = 0; starts.length < maxWindows; pass++) {
            let placed = 0;
            for (const span of spans) {
                if (starts.length >= maxWindows) break;
                const start = span.lo + pass * windowSeconds;
                if (start + windowSeconds > span.hi) continue;
                starts.push(Math.round(start * 100) / 100);
                placed++;
            }
            if (placed === 0) break;
        }

        if (starts.length > 0) {
            result[label] = starts.sort((a, b) => a - b);
        }
    }
    return result;
}

/** Speaker labels in numeric order, so the lowest number survives a merge. */
function sortLabels(labels: string[]): string[] {
    const num = (l: string) => Number(l.match(/(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    return [...labels].sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}

export interface ResolvedSpeakers {
    /** Original label -> final label. Always covers every input label. */
    mapping: Record<string, string>;
    /** Merged centroid per final label, L2-normalised. */
    centroids: Record<string, number[]>;
    /** Final label -> the original labels folded into it, for logging. */
    merged: Record<string, string[]>;
}

/**
 * Group labels whose voiceprints match, then renumber the survivors so the
 * transcript ends up with contiguous `Speaker 1..N`.
 *
 * Labels with no centroid (a speaker who never held the floor long enough to
 * sample) are kept as their own speaker rather than guessed at.
 */
export function resolveSpeakerLabels(
    labels: string[],
    centroids: Record<string, number[]>,
    threshold: number = DEFAULT_MERGE_SIMILARITY,
): ResolvedSpeakers {
    const groups: { members: string[]; vectors: number[][]; centroid?: number[] }[] =
        [];

    for (const label of sortLabels(labels)) {
        const embedding = centroids[label];
        if (!embedding) {
            groups.push({ members: [label], vectors: [] });
            continue;
        }
        const unit = normalize(embedding);

        let best: (typeof groups)[number] | undefined;
        let bestSim = threshold;
        for (const group of groups) {
            if (!group.centroid) continue;
            const sim = cosineSim(unit, group.centroid);
            if (sim >= bestSim) {
                best = group;
                bestSim = sim;
            }
        }

        if (best) {
            best.members.push(label);
            best.vectors.push(unit);
            best.centroid = averageEmbeddings(best.vectors);
        } else {
            groups.push({ members: [label], vectors: [unit], centroid: unit });
        }
    }

    const mapping: Record<string, string> = {};
    const mergedCentroids: Record<string, number[]> = {};
    const merged: Record<string, string[]> = {};
    groups.forEach((group, index) => {
        const finalLabel = `Speaker ${index + 1}`;
        for (const member of group.members) mapping[member] = finalLabel;
        if (group.centroid) mergedCentroids[finalLabel] = group.centroid;
        merged[finalLabel] = group.members;
    });

    return { mapping, centroids: mergedCentroids, merged };
}

/** Apply a label mapping to parsed turns, for anything keyed off final labels. */
export function relabelTurns(
    turns: GeminiTurn[],
    mapping: Record<string, string>,
): GeminiTurn[] {
    return turns.map((t) => ({ ...t, label: mapping[t.label] ?? t.label }));
}

/**
 * Longest turn per speaker, capped, so a stored voiceprint sample can be
 * auditioned as a short snippet in the settings UI.
 */
export function representativeTurns(
    turns: GeminiTurn[],
    maxSeconds = 12,
): Record<string, { start: number; end: number }> {
    const best: Record<string, { start: number; end: number }> = {};
    for (const turn of turns) {
        const current = best[turn.label];
        if (!current || turn.end - turn.start > current.end - current.start) {
            best[turn.label] = { start: turn.start, end: turn.end };
        }
    }
    const out: Record<string, { start: number; end: number }> = {};
    for (const [label, span] of Object.entries(best)) {
        out[label] = {
            start: span.start,
            end: Math.min(span.end, span.start + maxSeconds),
        };
    }
    return out;
}

/**
 * Rewrite the speaker labels in a transcript. The mapping is applied in one
 * pass, so renumbering that reuses a label (3 -> 2 while 2 -> 2) can't collide.
 */
export function applyLabelMapping(
    text: string,
    mapping: Record<string, string>,
): string {
    return text.replace(
        /^([ \t]*(?:\[\d{1,2}:\d{2}(?::\d{2})?\][ \t]*)?)(Speaker\s+\d+)(\s*:)/gim,
        (whole, prefix: string, label: string, colon: string) => {
            const canonical = mapping[label.replace(/\s+/g, " ").trim()];
            return canonical ? `${prefix}${canonical}${colon}` : whole;
        },
    );
}

/**
 * Join consecutive turns that now carry the same label, which is what a merge
 * leaves behind. Only runs on the label-prefixed format the prompt asks for.
 */
export function mergeAdjacentSameSpeakerTurns(text: string): string {
    const turnStart = /^(Speaker\s+\d+)\s*:\s*([\s\S]*)$/;
    const blocks = text
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

    const out: { label: string | null; body: string }[] = [];
    for (const block of blocks) {
        const m = block.match(turnStart);
        if (!m) {
            out.push({ label: null, body: block });
            continue;
        }
        const [, label, body] = m;
        const previous = out[out.length - 1];
        if (previous && previous.label === label) {
            previous.body = `${previous.body} ${body}`.replace(/\s+/g, " ").trim();
        } else {
            out.push({ label, body: body.trim() });
        }
    }

    return out
        .map((t) => (t.label ? `${t.label}: ${t.body}` : t.body))
        .join("\n\n");
}
