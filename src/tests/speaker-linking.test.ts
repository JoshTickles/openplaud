import { describe, expect, it } from "vitest";
import {
    linkSpeakersByOverlap,
    parseTimestampedTurns,
    rekeyByLink,
    stripTimestamps,
} from "@/lib/transcription/speaker-linking";

describe("parseTimestampedTurns", () => {
    const text = [
        "[0:05] Speaker 1: Hello there.",
        "",
        "[0:12] Speaker 2: Hi, how are you?",
        "",
        "[1:30] Speaker 1: Good thanks.",
    ].join("\n");

    it("parses [m:ss] turns with ranges bounded by the next turn", () => {
        const turns = parseTimestampedTurns(text, 120);
        expect(turns).toEqual([
            { label: "Speaker 1", start: 5, end: 12 },
            { label: "Speaker 2", start: 12, end: 90 },
            { label: "Speaker 1", start: 90, end: 120 },
        ]);
    });

    it("parses [h:mm:ss] timestamps", () => {
        const t = parseTimestampedTurns("[1:02:03] Speaker 1: hi", 4000);
        expect(t[0].start).toBe(3723);
    });

    it("returns [] when there are no timestamped turns", () => {
        expect(parseTimestampedTurns("Speaker 1: no timestamp here")).toEqual(
            [],
        );
    });
});

describe("linkSpeakersByOverlap", () => {
    it("matches Gemini labels to the cluster they overlap most, regardless of numbering", () => {
        // Gemini "Speaker 1" talks 0-10s; pyannote calls that voice SPEAKER_02.
        // Gemini "Speaker 2" talks 10-20s; pyannote calls it SPEAKER_00.
        const turns = [
            { label: "Speaker 1", start: 0, end: 10 },
            { label: "Speaker 2", start: 10, end: 20 },
        ];
        const segments = [
            { start: 0, end: 9, speaker: "SPEAKER_02" },
            { start: 10, end: 19, speaker: "SPEAKER_00" },
        ];
        expect(linkSpeakersByOverlap(turns, segments)).toEqual({
            "Speaker 1": "SPEAKER_02",
            "Speaker 2": "SPEAKER_00",
        });
    });

    it("is robust to small timestamp drift (majority overlap wins)", () => {
        // Speaker 1's turn edges are off by ~2s but still overlaps SPEAKER_01 most.
        const turns = [{ label: "Speaker 1", start: 38, end: 72 }];
        const segments = [
            { start: 40, end: 70, speaker: "SPEAKER_01" }, // 30s overlap
            { start: 71, end: 72, speaker: "SPEAKER_03" }, // 1s overlap
        ];
        expect(linkSpeakersByOverlap(turns, segments)).toEqual({
            "Speaker 1": "SPEAKER_01",
        });
    });

    it("never assigns one cluster to two Gemini speakers", () => {
        const turns = [
            { label: "Speaker 1", start: 0, end: 10 },
            { label: "Speaker 2", start: 5, end: 8 }, // overlaps same cluster, weaker
        ];
        const segments = [{ start: 0, end: 10, speaker: "SPEAKER_00" }];
        const link = linkSpeakersByOverlap(turns, segments);
        const clusters = Object.values(link);
        expect(new Set(clusters).size).toBe(clusters.length);
        expect(link["Speaker 1"]).toBe("SPEAKER_00"); // stronger overlap wins
    });

    it("returns {} when nothing overlaps", () => {
        const turns = [{ label: "Speaker 1", start: 0, end: 5 }];
        const segments = [{ start: 100, end: 110, speaker: "SPEAKER_00" }];
        expect(linkSpeakersByOverlap(turns, segments)).toEqual({});
    });
});

describe("rekeyByLink", () => {
    it("moves diarize-keyed values onto Gemini labels", () => {
        const centroids = { SPEAKER_00: [1, 0], SPEAKER_02: [0, 1] };
        const link = { "Speaker 1": "SPEAKER_02", "Speaker 2": "SPEAKER_00" };
        expect(rekeyByLink(centroids, link)).toEqual({
            "Speaker 1": [0, 1],
            "Speaker 2": [1, 0],
        });
    });

    it("drops links whose diarize label has no value", () => {
        expect(rekeyByLink({ SPEAKER_00: [1] }, { "Speaker 1": "SPEAKER_09" })).toEqual(
            {},
        );
    });
});

describe("stripTimestamps", () => {
    it("removes [m:ss] and [h:mm:ss] prefixes, keeps the rest", () => {
        const input = "[0:05] Speaker 1: Hello.\n[1:02:03] Speaker 2: Hi.";
        expect(stripTimestamps(input)).toBe(
            "Speaker 1: Hello.\nSpeaker 2: Hi.",
        );
    });
});
