import { describe, expect, it } from "vitest";
import {
    cosineSim,
    matchSpeakers,
    mergeVoiceprint,
    normalize,
    type Voiceprint,
} from "@/lib/transcription/voiceprint-match";

describe("cosineSim", () => {
    it("returns 1 for identical direction, 0 for orthogonal", () => {
        expect(cosineSim([1, 0], [2, 0])).toBeCloseTo(1);
        expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it("is safe on bad input", () => {
        expect(cosineSim([], [])).toBe(0);
        expect(cosineSim([1, 2], [1])).toBe(0);
        expect(cosineSim([0, 0], [1, 1])).toBe(0);
    });
});

describe("matchSpeakers", () => {
    const lib: Voiceprint[] = [
        { name: "Indy", embedding: normalize([1, 0, 0]), sampleCount: 3 },
        { name: "Parm", embedding: normalize([0, 1, 0]), sampleCount: 2 },
    ];

    it("suggests the closest known name above threshold", () => {
        const out = matchSpeakers(
            {
                SPEAKER_00: normalize([0.9, 0.1, 0]), // ~Indy
                SPEAKER_01: normalize([0.05, 0.95, 0]), // ~Parm
            },
            lib,
            0.5,
        );
        expect(out.SPEAKER_00.name).toBe("Indy");
        expect(out.SPEAKER_01.name).toBe("Parm");
    });

    it("returns null when nothing clears the threshold", () => {
        const out = matchSpeakers({ SPEAKER_00: normalize([0, 0, 1]) }, lib, 0.5);
        expect(out.SPEAKER_00.name).toBeNull();
    });

    it("never assigns one known name to two speakers", () => {
        // Both speakers look like Indy; only the best gets the name.
        const out = matchSpeakers(
            {
                SPEAKER_00: normalize([1, 0, 0]),
                SPEAKER_01: normalize([0.8, 0.05, 0]),
            },
            lib,
            0.5,
        );
        const names = [out.SPEAKER_00.name, out.SPEAKER_01.name];
        expect(names.filter((n) => n === "Indy")).toHaveLength(1);
    });

    it("returns all-null with an empty library", () => {
        const out = matchSpeakers({ SPEAKER_00: [1, 0, 0] }, [], 0.5);
        expect(out.SPEAKER_00.name).toBeNull();
    });
});

describe("mergeVoiceprint", () => {
    it("running-averages toward the new sample and increments count", () => {
        const existing: Voiceprint = {
            name: "Indy",
            embedding: normalize([1, 0, 0]),
            sampleCount: 1,
        };
        const merged = mergeVoiceprint(existing, normalize([0, 1, 0]));
        expect(merged.sampleCount).toBe(2);
        // Averaged then normalised: should sit between the two, not equal either.
        expect(merged.embedding[0]).toBeGreaterThan(0);
        expect(merged.embedding[1]).toBeGreaterThan(0);
        expect(cosineSim(merged.embedding, [1, 1, 0])).toBeCloseTo(1);
    });

    it("resets to the new sample on a dimension change", () => {
        const existing: Voiceprint = {
            name: "Indy",
            embedding: [1, 0],
            sampleCount: 5,
        };
        const merged = mergeVoiceprint(existing, [0, 0, 1]);
        expect(merged.sampleCount).toBe(1);
        expect(merged.embedding).toHaveLength(3);
    });
});
