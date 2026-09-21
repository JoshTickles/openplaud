/**
 * Turns a timestamped transcript into one voiceprint per speaker the model
 * identified, by sampling a bounded amount of that speaker's audio.
 *
 * The model's own speaker labels are authoritative and are never rewritten
 * here. The voiceprints exist to recognise those speakers in later recordings.
 *
 * Everything here is pure. The audio work lives in `scripts/embed-speaker-turns.py`.
 */

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
