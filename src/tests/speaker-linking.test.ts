import { describe, expect, it } from "vitest";
import {
    parseTimestampedTurns,
    stripTimestamps,
    transcriptSpeakerLabels,
} from "@/lib/transcription/speaker-linking";

describe("transcriptSpeakerLabels", () => {
    it("finds labels behind [m:ss] timestamps (model transcripts)", () => {
        const text = [
            "[0:02] Speaker 1: Hello, Josh speaking.",
            "[0:04] Speaker 2: Hey Josh.",
            "[11:58] Speaker 1: Bye.",
        ].join("\n");
        expect(transcriptSpeakerLabels(text)).toEqual([
            "Speaker 1",
            "Speaker 2",
        ]);
    });

    it("finds bare line-initial labels (Plaud cloud transcripts)", () => {
        const text =
            "Speaker 1: Hello Josh.\n\nSpeaker 2: Hi guys.\n\nSpeaker 1: Busy week.";
        expect(transcriptSpeakerLabels(text)).toEqual([
            "Speaker 1",
            "Speaker 2",
        ]);
    });

    it("handles double-digit speakers and extra spaces", () => {
        expect(transcriptSpeakerLabels("[2:00] Speaker  10: hi")).toEqual([
            "Speaker 10",
        ]);
    });

    it("ignores quoted speech that merely mentions a label", () => {
        const text =
            '[0:10] Speaker 1: He said "Speaker 3: liar" once.\n[0:12] Speaker 2: Lol.';
        expect(transcriptSpeakerLabels(text)).toEqual([
            "Speaker 1",
            "Speaker 2",
        ]);
    });

    it("returns nothing for transcripts without speaker lines", () => {
        expect(transcriptSpeakerLabels("just prose, no labels")).toEqual([]);
    });
});

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

    it("gives the final turn a zero-length range when the duration is unknown", () => {
        const t = parseTimestampedTurns("[0:10] Speaker 1: hi");
        expect(t[0]).toEqual({ label: "Speaker 1", start: 10, end: 10 });
    });

    it("returns [] when there are no timestamped turns", () => {
        expect(parseTimestampedTurns("Speaker 1: no timestamp here")).toEqual(
            [],
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
