import { describe, expect, it } from "vitest";
import {
    DEFAULT_MERGE_SIMILARITY,
    applyLabelMapping,
    mergeAdjacentSameSpeakerTurns,
    resolveSpeakerLabels,
    selectSampleWindows,
} from "@/lib/transcription/speaker-sampling";

const OPTS = { windowSeconds: 3, targetSecondsPerSpeaker: 9, edgeTrimSeconds: 0.5 };

describe("selectSampleWindows", () => {
    it("caps each speaker at the target amount of audio", () => {
        // One 120s monologue: far more audio available than we want.
        const windows = selectSampleWindows(
            [{ label: "Speaker 1", start: 0, end: 120 }],
            OPTS,
        );
        expect(windows["Speaker 1"]).toHaveLength(3); // 9s target / 3s windows
    });

    it("spreads windows across turns instead of draining the longest one", () => {
        const windows = selectSampleWindows(
            [
                { label: "Speaker 1", start: 0, end: 60 },
                { label: "Speaker 1", start: 200, end: 210 },
                { label: "Speaker 1", start: 500, end: 510 },
            ],
            OPTS,
        );
        // One window from each turn before taking a second from any of them.
        expect(windows["Speaker 1"]).toEqual([0.5, 200.5, 500.5]);
    });

    it("samples a speaker who only appears at the very end", () => {
        const windows = selectSampleWindows(
            [
                { label: "Speaker 1", start: 0, end: 1700 },
                { label: "Speaker 2", start: 1700, end: 1712 },
            ],
            OPTS,
        );
        expect(windows["Speaker 2"]).toEqual([1700.5, 1703.5, 1706.5]);
    });

    it("trims turn edges so a window can't clip the neighbouring voice", () => {
        const windows = selectSampleWindows(
            [{ label: "Speaker 1", start: 10, end: 24 }],
            OPTS,
        );
        expect(windows["Speaker 1"][0]).toBe(10.5);
        const last = windows["Speaker 1"].at(-1) as number;
        expect(last + 3).toBeLessThanOrEqual(24 - 0.5);
    });

    it("uses a barely-long-enough turn untrimmed rather than dropping it", () => {
        const windows = selectSampleWindows(
            [{ label: "Speaker 2", start: 5, end: 8.2 }],
            OPTS,
        );
        expect(windows["Speaker 2"]).toEqual([5]);
    });

    it("omits a speaker whose every turn is too short to sample", () => {
        const windows = selectSampleWindows(
            [
                { label: "Speaker 1", start: 0, end: 30 },
                { label: "Speaker 2", start: 30, end: 31 },
            ],
            OPTS,
        );
        expect(windows["Speaker 2"]).toBeUndefined();
        expect(windows["Speaker 1"]).toBeDefined();
    });

    it("returns {} when the transcript had no timestamps to work from", () => {
        expect(selectSampleWindows([], OPTS)).toEqual({});
    });
});

// Two well-separated voices, plus a near-duplicate of the first.
const VOICE_A = [1, 0, 0, 0];
const VOICE_A_AGAIN = [0.97, 0.05, 0.1, 0];
const VOICE_B = [0, 1, 0, 0];

describe("resolveSpeakerLabels", () => {
    it("folds an over-split speaker back together and renumbers", () => {
        const resolved = resolveSpeakerLabels(
            ["Speaker 1", "Speaker 2", "Speaker 3"],
            {
                "Speaker 1": VOICE_A,
                "Speaker 2": VOICE_B,
                "Speaker 3": VOICE_A_AGAIN, // really Speaker 1
            },
        );
        expect(resolved.mapping).toEqual({
            "Speaker 1": "Speaker 1",
            "Speaker 3": "Speaker 1",
            "Speaker 2": "Speaker 2",
        });
        expect(resolved.merged["Speaker 1"]).toEqual(["Speaker 1", "Speaker 3"]);
        expect(Object.keys(resolved.centroids).sort()).toEqual([
            "Speaker 1",
            "Speaker 2",
        ]);
    });

    it("leaves genuinely distinct speakers alone", () => {
        const resolved = resolveSpeakerLabels(["Speaker 1", "Speaker 2"], {
            "Speaker 1": VOICE_A,
            "Speaker 2": VOICE_B,
        });
        expect(resolved.mapping).toEqual({
            "Speaker 1": "Speaker 1",
            "Speaker 2": "Speaker 2",
        });
    });

    it("renumbers contiguously when a low-numbered label is absorbed", () => {
        const resolved = resolveSpeakerLabels(
            ["Speaker 1", "Speaker 2", "Speaker 3"],
            {
                "Speaker 1": VOICE_A,
                "Speaker 2": VOICE_A_AGAIN, // merges into Speaker 1
                "Speaker 3": VOICE_B,
            },
        );
        // Speaker 3 becomes Speaker 2; no gap is left behind.
        expect(resolved.mapping["Speaker 3"]).toBe("Speaker 2");
        expect(new Set(Object.values(resolved.mapping)).size).toBe(2);
    });

    it("keeps a label with no centroid as its own speaker", () => {
        const resolved = resolveSpeakerLabels(["Speaker 1", "Speaker 2"], {
            "Speaker 1": VOICE_A,
        });
        expect(resolved.mapping["Speaker 2"]).toBe("Speaker 2");
        expect(resolved.centroids["Speaker 2"]).toBeUndefined();
    });

    it("respects the threshold: a looser one merges what a strict one keeps apart", () => {
        const borderline = { "Speaker 1": VOICE_A, "Speaker 2": [0.7, 0.71, 0, 0] };
        const labels = ["Speaker 1", "Speaker 2"];
        expect(
            resolveSpeakerLabels(labels, borderline, 0.9).mapping["Speaker 2"],
        ).toBe("Speaker 2");
        expect(
            resolveSpeakerLabels(labels, borderline, 0.4).mapping["Speaker 2"],
        ).toBe("Speaker 1");
    });

    it("uses a threshold that separates real measured voices", () => {
        // Distinct speakers in one recording measured 0.13-0.35; the same person
        // across recordings measured 0.91.
        expect(DEFAULT_MERGE_SIMILARITY).toBeGreaterThan(0.35);
        expect(DEFAULT_MERGE_SIMILARITY).toBeLessThan(0.91);
    });
});

describe("applyLabelMapping", () => {
    it("applies a renumbering that reuses labels without collapsing everyone", () => {
        const text = [
            "[0:05] Speaker 1: a",
            "",
            "[0:10] Speaker 2: b",
            "",
            "[0:20] Speaker 3: c",
        ].join("\n");
        const out = applyLabelMapping(text, {
            "Speaker 1": "Speaker 1",
            "Speaker 2": "Speaker 1",
            "Speaker 3": "Speaker 2",
        });
        expect(out).toContain("[0:10] Speaker 1: b");
        expect(out).toContain("[0:20] Speaker 2: c");
    });

    it("leaves body text and unmapped labels untouched", () => {
        const text = "Speaker 1: I told Speaker 2: nothing\n\nSpeaker 9: hi";
        const out = applyLabelMapping(text, { "Speaker 1": "Speaker 2" });
        expect(out).toBe("Speaker 2: I told Speaker 2: nothing\n\nSpeaker 9: hi");
    });
});

describe("mergeAdjacentSameSpeakerTurns", () => {
    it("joins turns that a merge left adjacent", () => {
        const text = "Speaker 1: first.\n\nSpeaker 1: second.\n\nSpeaker 2: reply.";
        expect(mergeAdjacentSameSpeakerTurns(text)).toBe(
            "Speaker 1: first. second.\n\nSpeaker 2: reply.",
        );
    });

    it("does not join turns separated by another speaker", () => {
        const text = "Speaker 1: a\n\nSpeaker 2: b\n\nSpeaker 1: c";
        expect(mergeAdjacentSameSpeakerTurns(text)).toBe(text);
    });
});
