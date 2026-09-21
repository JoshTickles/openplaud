import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContentStream = vi.fn();
const embedSpeakerTurns = vi.fn();
const isVoiceprintEmbeddingAvailable = vi.fn();

vi.mock("@google/genai", () => ({
    GoogleGenAI: class {
        models = { generateContentStream };
    },
}));

vi.mock("@/lib/transcription/voiceprint-extract", () => ({
    embedSpeakerTurns,
    isVoiceprintEmbeddingAvailable,
}));

function stream(text: string) {
    return Promise.resolve({
        async *[Symbol.asyncIterator]() {
            yield { text };
        },
    });
}

/**
 * Speaker 1 and Speaker 3 have near-identical voiceprints. They must still be
 * kept apart: the model heard four people on a real recording and an earlier
 * similarity-merge collapsed two of them, so the model's count is trusted.
 */
const SIMILAR_VOICES = [
    "[0:00] Speaker 1: I'll kick us off with the migration status.",
    "",
    "[0:20] Speaker 2: Sounds good, what's the blocker there?",
    "",
    "[0:40] Speaker 3: The blocker is the certificate rotation, which I own.",
].join("\n\n");

const VOICE_A = [1, 0, 0, 0];
const VOICE_A_AGAIN = [0.99, 0.02, 0.04, 0];
const VOICE_B = [0, 1, 0, 0];

async function transcribe(options: Record<string, unknown> = {}) {
    const { GoogleSpeechTranscriptionProvider } = await import(
        "@/lib/transcription/providers/google-speech-provider"
    );
    const provider = new GoogleSpeechTranscriptionProvider("unused-key");
    return provider.transcribe(Buffer.from("ID3fake"), "a.mp3", {
        model: "gemini-3-flash-preview",
        responseFormat: "diarized_json",
        audioPath: "/tmp/a.mp3",
        audioDurationSeconds: 70,
        ...options,
    });
}

describe("speaker fingerprinting in the transcription path", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TRANSCRIPTION_BACKEND = "vertex";
        process.env.GOOGLE_PROJECT_ID = "test-project";
        generateContentStream.mockImplementation(() => stream(SIMILAR_VOICES));
        isVoiceprintEmbeddingAvailable.mockResolvedValue(true);
        embedSpeakerTurns.mockResolvedValue({
            centroids: {
                "Speaker 1": VOICE_A,
                "Speaker 2": VOICE_B,
                "Speaker 3": VOICE_A_AGAIN,
            },
            windowCounts: { "Speaker 1": 6, "Speaker 2": 6, "Speaker 3": 6 },
        });
    });

    it("samples only the audio it needs, from the transcript's own turns", async () => {
        await transcribe();

        expect(embedSpeakerTurns).toHaveBeenCalledTimes(1);
        const [audioPath, windows, windowSeconds] =
            embedSpeakerTurns.mock.calls[0];
        expect(audioPath).toBe("/tmp/a.mp3");
        expect(windowSeconds).toBe(3);
        // Every emitted label is sampled, and none is drained beyond the cap.
        expect(Object.keys(windows).sort()).toEqual([
            "Speaker 1",
            "Speaker 2",
            "Speaker 3",
        ]);
        for (const starts of Object.values(
            windows as Record<string, number[]>,
        )) {
            expect(starts.length).toBeLessThanOrEqual(6);
        }
    });

    it("never rewrites the model's speaker labels, however alike two voices are", async () => {
        const result = await transcribe();

        expect(result.text).toContain("certificate rotation");
        const labels = [...result.text.matchAll(/^(Speaker \d+):/gm)].map(
            (m) => m[1],
        );
        expect(new Set(labels)).toEqual(
            new Set(["Speaker 1", "Speaker 2", "Speaker 3"]),
        );
    });

    it("stores one centroid and snippet range per label the model emitted", async () => {
        const result = await transcribe();

        expect(Object.keys(result.speakerCentroids ?? {}).sort()).toEqual([
            "Speaker 1",
            "Speaker 2",
            "Speaker 3",
        ]);
        expect(Object.keys(result.speakerSegments ?? {}).sort()).toEqual([
            "Speaker 1",
            "Speaker 2",
            "Speaker 3",
        ]);
        expect(result.speakerNotice).toBeUndefined();
    });

    it("strips the timestamps from the stored transcript", async () => {
        const result = await transcribe();
        expect(result.text).not.toMatch(/\[\d{1,2}:\d{2}\]/);
    });

    it("warns instead of failing when the embedding runtime is missing", async () => {
        isVoiceprintEmbeddingAvailable.mockResolvedValue(false);

        const result = await transcribe();

        expect(embedSpeakerTurns).not.toHaveBeenCalled();
        expect(result.speakerNotice).toMatch(/unavailable/i);
        expect(result.text).toContain("certificate rotation");
        expect(result.speakerCentroids).toBeUndefined();
    });

    it("keeps the transcript when embedding fails outright", async () => {
        embedSpeakerTurns.mockRejectedValue(new Error("python died"));

        const result = await transcribe();

        expect(result.speakerNotice).toMatch(/failed/i);
        expect(result.text).toContain("certificate rotation");
        expect(result.text).toMatch(/Speaker 3/);
    });

    it("warns when the model returned no timestamps to sample from", async () => {
        generateContentStream.mockImplementation(() =>
            stream("Speaker 1: no timestamps here\n\nSpeaker 2: none here either"),
        );

        const result = await transcribe();

        expect(embedSpeakerTurns).not.toHaveBeenCalled();
        expect(result.speakerNotice).toMatch(/no voiceprints/i);
    });

    it("skips fingerprinting entirely when diarization is off", async () => {
        const result = await transcribe({ responseFormat: "verbose_json" });

        expect(isVoiceprintEmbeddingAvailable).not.toHaveBeenCalled();
        expect(embedSpeakerTurns).not.toHaveBeenCalled();
        expect(result.speakerNotice).toBeUndefined();
    });
});
