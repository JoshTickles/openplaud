import { describe, expect, it } from "vitest";
import {
    averageEmbeddings,
    centroidForTranscriptLabel,
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

describe("centroidForTranscriptLabel", () => {
    // The seam that silently broke enrollment: speakerMap is keyed by transcript
    // labels ("Speaker 1") but centroids are keyed by diarize labels
    // ("SPEAKER_00"). A direct centroids[label] lookup misses every time.
    const centroids = {
        SPEAKER_00: [1, 0, 0],
        SPEAKER_01: [0, 1, 0],
        SPEAKER_02: [0, 0, 1],
    };

    it("maps 'Speaker N' to the Nth sorted diarize centroid", () => {
        expect(centroidForTranscriptLabel("Speaker 1", centroids)).toEqual([1, 0, 0]);
        expect(centroidForTranscriptLabel("Speaker 2", centroids)).toEqual([0, 1, 0]);
        expect(centroidForTranscriptLabel("Speaker 3", centroids)).toEqual([0, 0, 1]);
    });

    it("does NOT return undefined for a real transcript label (regression)", () => {
        // The original bug: centroids["Speaker 1"] === undefined -> speaker skipped.
        expect(centroidForTranscriptLabel("Speaker 1", centroids)).toBeDefined();
    });

    it("tolerates flexible spacing in the label", () => {
        expect(centroidForTranscriptLabel("Speaker  2", centroids)).toEqual([0, 1, 0]);
        expect(centroidForTranscriptLabel("speaker3", centroids)).toEqual([0, 0, 1]);
    });

    it("resolves against sorted order, not insertion order", () => {
        const shuffled = {
            SPEAKER_02: [0, 0, 1],
            SPEAKER_00: [1, 0, 0],
            SPEAKER_01: [0, 1, 0],
        };
        expect(centroidForTranscriptLabel("Speaker 1", shuffled)).toEqual([1, 0, 0]);
    });

    it("falls back to a direct match for already-diarize labels", () => {
        expect(centroidForTranscriptLabel("SPEAKER_01", centroids)).toEqual([0, 1, 0]);
    });

    it("returns undefined when the index is out of range", () => {
        expect(centroidForTranscriptLabel("Speaker 9", centroids)).toBeUndefined();
    });
});

describe("enrollment mapping (end-to-end seam)", () => {
    // Mirror what enrollVoiceprints does: for a real transcript speakerMap +
    // diarize-keyed centroids, every named speaker must resolve to a centroid.
    // The original code produced ZERO enrollments here.
    it("resolves a centroid for every named speaker in a real-shaped map", () => {
        const speakerMap = {
            "Speaker 1": "Akie",
            "Speaker 2": "Josh",
            "Speaker 3": "Hara-san",
        };
        const centroids = {
            SPEAKER_00: [0.9, 0.1, 0],
            SPEAKER_01: [0.1, 0.9, 0],
            SPEAKER_02: [0, 0.1, 0.9],
        };

        const enrolled: Record<string, number[]> = {};
        for (const [label, name] of Object.entries(speakerMap)) {
            const c = centroidForTranscriptLabel(label, centroids);
            if (c) enrolled[name] = c;
        }

        expect(Object.keys(enrolled)).toEqual(["Akie", "Josh", "Hara-san"]);
        expect(enrolled.Josh).toEqual([0.1, 0.9, 0]);
    });

    it("still resolves names when diarize found more clusters than named speakers", () => {
        // Diarize over-detected (8 clusters), transcript named only 6.
        const speakerMap = {
            "Speaker 1": "Miquel",
            "Speaker 5": "Josh",
            "Speaker 6": "Ethan",
        };
        const centroids: Record<string, number[]> = {};
        for (let i = 0; i < 8; i++) {
            centroids[`SPEAKER_0${i}`] = Array.from({ length: 4 }, (_, j) =>
                j === i % 4 ? 1 : 0,
            );
        }
        expect(centroidForTranscriptLabel("Speaker 1", centroids)).toBeDefined();
        expect(centroidForTranscriptLabel("Speaker 5", centroids)).toBeDefined();
        expect(centroidForTranscriptLabel("Speaker 6", centroids)).toBeDefined();
    });
});

describe("averageEmbeddings", () => {
    it("returns the normalised mean of equal-length vectors", () => {
        const mean = averageEmbeddings([
            [1, 0, 0],
            [0, 1, 0],
        ]);
        // Mean is [0.5,0.5,0] -> normalised.
        expect(cosineSim(mean, [1, 1, 0])).toBeCloseTo(1);
    });

    it("is a no-op direction for a single sample (just normalises)", () => {
        const mean = averageEmbeddings([[3, 0, 0]]);
        expect(mean).toEqual([1, 0, 0]);
    });

    it("ignores vectors whose length doesn't match the first", () => {
        const mean = averageEmbeddings([
            [1, 0],
            [0, 1, 0], // wrong dim, dropped
        ]);
        expect(mean).toEqual([1, 0]);
    });

    it("returns [] for empty input", () => {
        expect(averageEmbeddings([])).toEqual([]);
    });

    it("removing a sample shifts the mean toward the survivors", () => {
        // Three samples; dropping the odd one out moves the mean.
        const all = averageEmbeddings([
            [1, 0, 0],
            [1, 0, 0],
            [0, 0, 1],
        ]);
        const pruned = averageEmbeddings([
            [1, 0, 0],
            [1, 0, 0],
        ]);
        expect(cosineSim(pruned, [1, 0, 0])).toBeCloseTo(1);
        // The pruned mean is closer to [1,0,0] than the full one.
        expect(cosineSim(pruned, [1, 0, 0])).toBeGreaterThan(
            cosineSim(all, [1, 0, 0]),
        );
    });
});
