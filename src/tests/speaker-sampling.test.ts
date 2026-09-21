import { describe, expect, it } from "vitest";
import {
    representativeTurns,
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

describe("representativeTurns", () => {
    it("picks each speaker's longest turn, capped", () => {
        const turns = [
            { label: "Speaker 1", start: 0, end: 4, text: "short" },
            { label: "Speaker 1", start: 10, end: 40, text: "long" },
            { label: "Speaker 2", start: 50, end: 56, text: "only" },
        ];
        expect(representativeTurns(turns, 12)).toEqual({
            "Speaker 1": { start: 10, end: 22 },
            "Speaker 2": { start: 50, end: 56 },
        });
    });

    it("keeps the model's labels exactly as emitted", () => {
        const turns = [
            { label: "Speaker 4", start: 0, end: 20, text: "a" },
            { label: "Speaker 1", start: 30, end: 50, text: "b" },
        ];
        expect(Object.keys(representativeTurns(turns)).sort()).toEqual([
            "Speaker 1",
            "Speaker 4",
        ]);
    });
});
