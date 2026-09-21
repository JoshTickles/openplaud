import { describe, expect, it } from "vitest";
import {
    parseTimestampedTurns,
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

    it("gives the final turn a zero-length range when the duration is unknown", () => {
        const t = parseTimestampedTurns("[0:10] Speaker 1: hi");
        expect(t[0]).toEqual({ label: "Speaker 1", start: 10, end: 10 });
    });

    it("returns [] when there are no timestamped turns", () => {
        expect(parseTimestampedTurns("Speaker 1: no timestamp here")).toEqual([]);
    });
});

describe("stripTimestamps", () => {
    it("removes [m:ss] and [h:mm:ss] prefixes, keeps the rest", () => {
        const input = "[0:05] Speaker 1: Hello.\n[1:02:03] Speaker 2: Hi.";
        expect(stripTimestamps(input)).toBe("Speaker 1: Hello.\nSpeaker 2: Hi.");
    });
});
