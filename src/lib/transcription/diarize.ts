/**
 * Speaker diarization wrapper.
 *
 * Calls the Python `diarize` library via child_process to get
 * voice-fingerprint-based speaker segments. These segments are then
 * used to guide Gemini's transcription for accurate speaker attribution.
 */
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";

export interface DiarizeSegment {
    start: number;
    end: number;
    speaker: string;
    duration: number;
}

export interface DiarizeResult {
    num_speakers: number;
    speakers: string[];
    audio_duration: number;
    segments: DiarizeSegment[];
}

const DIARIZE_SCRIPT = "./scripts/run-diarize.py";
const DIARIZE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max

/**
 * Check whether the Python diarization runtime is available.
 * Returns false if python3 or the diarize script is missing.
 */
export async function isDiarizationAvailable(): Promise<boolean> {
    try {
        await access(DIARIZE_SCRIPT, constants.R_OK);
        return await new Promise((resolve) => {
            execFile("python3", ["-c", "import diarize"], { timeout: 15_000 }, (err) => {
                resolve(!err);
            });
        });
    } catch {
        return false;
    }
}

/**
 * Run speaker diarization on an audio file.
 *
 * @param audioPath Absolute path to the audio file on disk
 * @param options Optional speaker count hints
 * @returns Diarization result with speaker segments and timestamps
 */
export async function runDiarization(
    audioPath: string,
    options?: {
        minSpeakers?: number;
        maxSpeakers?: number;
        numSpeakers?: number;
    },
): Promise<DiarizeResult> {
    const args = [DIARIZE_SCRIPT, audioPath];

    if (options?.numSpeakers != null) {
        args.push("--num-speakers", String(options.numSpeakers));
    } else {
        if (options?.minSpeakers != null) {
            args.push("--min-speakers", String(options.minSpeakers));
        }
        if (options?.maxSpeakers != null) {
            args.push("--max-speakers", String(options.maxSpeakers));
        }
    }

    return new Promise((resolve, reject) => {
        execFile(
            "python3",
            args,
            { timeout: DIARIZE_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    console.error("[Diarize] stderr:", stderr);
                    reject(new Error(`Diarization failed: ${error.message}`));
                    return;
                }

                try {
                    // The Python script may emit download progress or
                    // other noise before the JSON object. Find the
                    // first '{' to locate the actual JSON payload.
                    const jsonStart = stdout.indexOf("{");
                    const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
                    if (jsonStart > 0) {
                        console.warn(
                            `[Diarize] Stripped ${jsonStart} bytes of non-JSON prefix from stdout`,
                        );
                    }
                    const result = JSON.parse(jsonStr) as DiarizeResult;
                    console.log(
                        `[Diarize] Found ${result.num_speakers} speakers ` +
                        `in ${result.audio_duration.toFixed(0)}s audio ` +
                        `(${result.segments.length} segments)`,
                    );
                    resolve(result);
                } catch (parseErr) {
                    reject(
                        new Error(
                            `Failed to parse diarization output: ${parseErr}`,
                        ),
                    );
                }
            },
        );
    });
}

/**
 * Merge adjacent segments from the same speaker when the gap between
 * them is shorter than `maxGap` seconds. This cleans up diarization
 * noise where a speaker's turn is split by a sub-second silence.
 */
function mergeAdjacentSegments(
    segments: DiarizeSegment[],
    maxGap = 1.5,
): DiarizeSegment[] {
    if (segments.length === 0) return [];

    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const merged: DiarizeSegment[] = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = sorted[i];

        if (curr.speaker === prev.speaker && curr.start - prev.end <= maxGap) {
            prev.end = Math.max(prev.end, curr.end);
            prev.duration = prev.end - prev.start;
        } else {
            merged.push({ ...curr });
        }
    }

    return merged;
}

/**
 * Format diarization segments into a prompt hint for Gemini.
 *
 * Produces a chronological timeline so Gemini can follow speaker changes
 * as it processes the audio linearly.
 */
export function formatDiarizeHint(result: DiarizeResult): string {
    if (result.segments.length === 0) return "";

    const segments = mergeAdjacentSegments(result.segments);

    // Build speaker label map: SPEAKER_00 → Speaker 1, etc.
    const sortedSpeakers = [...result.speakers].sort();
    const labelMap = new Map<string, string>();
    for (let i = 0; i < sortedSpeakers.length; i++) {
        labelMap.set(sortedSpeakers[i], `Speaker ${i + 1}`);
    }

    // Chronological segment list
    const lines = segments.map((seg) => {
        const label = labelMap.get(seg.speaker) ?? seg.speaker;
        return `${formatTimestamp(seg.start)} - ${formatTimestamp(seg.end)} → ${label}`;
    });

    return [
        `SPEAKER TIMELINE FROM VOICE ANALYSIS (${result.num_speakers} speakers detected):`,
        ...lines,
        "",
        "Use this timeline as a guide to assign speaker labels. The timestamps are",
        "based on voice fingerprint analysis and are generally reliable, but boundaries",
        "at quick turn-takes may be slightly off. When the content of a sentence clearly",
        "belongs to the other speaker (e.g. continuing their thought, answering their",
        "own question), trust the content over the timestamp boundary.",
        `Mapping: ${sortedSpeakers.map((s, i) => `${s} = Speaker ${i + 1}`).join(", ")}`,
    ].join("\n");
}

function formatTimestamp(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
