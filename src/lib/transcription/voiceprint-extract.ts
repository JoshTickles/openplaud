/**
 * Runs `scripts/embed-speaker-turns.py` to turn a handful of time windows per
 * speaker into one voiceprint centroid per speaker.
 *
 * This is the whole audio side of speaker fingerprinting. It replaced full-file
 * diarization, which embedded every window of every turn (2,600+ embeddings for
 * a four-person meeting) and was OOM-killed on long recordings.
 */
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";

const EMBED_SCRIPT = "./scripts/embed-speaker-turns.py";
const EMBED_TIMEOUT_MS = 10 * 60 * 1000;

export interface EmbedResult {
    /** Final label -> L2-normalised centroid. Labels with no usable window are absent. */
    centroids: Record<string, number[]>;
    /** How many windows actually contributed per label. */
    windowCounts: Record<string, number>;
}

/** Whether the embedding runtime is present. */
export async function isVoiceprintEmbeddingAvailable(): Promise<boolean> {
    try {
        await access(EMBED_SCRIPT, constants.R_OK);
        return await new Promise((resolve) => {
            execFile(
                "python3",
                ["-c", "import wespeakerruntime, soundfile"],
                { timeout: 15_000 },
                (err) => resolve(!err),
            );
        });
    } catch {
        return false;
    }
}

/**
 * Embed the given window start times, grouped by speaker label.
 *
 * @param audioPath Absolute path to the audio file on disk
 * @param windows Speaker label -> window start times in seconds
 * @param windowSeconds Length of every window; constant so the ONNX model sees
 *   one input shape and does not leak memory per call
 */
export async function embedSpeakerTurns(
    audioPath: string,
    windows: Record<string, number[]>,
    windowSeconds: number,
): Promise<EmbedResult> {
    const payload = JSON.stringify({
        audio_path: audioPath,
        window_seconds: windowSeconds,
        windows,
    });
    const totalWindows = Object.values(windows).reduce(
        (n, w) => n + w.length,
        0,
    );

    return new Promise((resolve, reject) => {
        const child = execFile(
            "python3",
            [EMBED_SCRIPT],
            { timeout: EMBED_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    console.error("[Voiceprint] stderr:", stderr.slice(-2000));
                    reject(
                        new Error(`Voiceprint embedding failed: ${error.message}`),
                    );
                    return;
                }
                try {
                    // The script writes library chatter to stderr, but guard
                    // against a stray prefix on stdout regardless.
                    const start = stdout.indexOf("{");
                    const parsed = JSON.parse(
                        start >= 0 ? stdout.slice(start) : stdout,
                    ) as {
                        centroids: Record<string, number[]>;
                        window_counts: Record<string, number>;
                    };
                    console.log(
                        `[Voiceprint] Embedded ${totalWindows} windows for ` +
                        `${Object.keys(parsed.centroids).length} speakers`,
                    );
                    resolve({
                        centroids: parsed.centroids ?? {},
                        windowCounts: parsed.window_counts ?? {},
                    });
                } catch (parseErr) {
                    reject(
                        new Error(
                            `Failed to parse voiceprint output: ${parseErr}`,
                        ),
                    );
                }
            },
        );
        child.stdin?.end(payload);
    });
}
