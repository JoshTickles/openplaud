/**
 * Reads the speaker turns back out of a transcript.
 *
 * The model is asked to prefix every turn with `[m:ss]`, which makes the
 * transcript self-describing: each turn's label and time range are known
 * without a separate diarization pass. Speaker fingerprinting samples audio
 * from these ranges (see `speaker-sampling.ts`).
 */

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

/** Remove leading `[m:ss] ` / `[h:mm:ss] ` timestamps from every line. */
export function stripTimestamps(text: string): string {
    return text.replace(/^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/gim, "");
}
