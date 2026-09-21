import { describe, expect, it } from "vitest";
import {
    isPlaceholderSpeakerName,
    isSameVoiceprintName,
    normalizeVoiceprintName,
    suggestNames,
} from "@/lib/voiceprints/names";

describe("normalizeVoiceprintName", () => {
    it("ignores case and surrounding whitespace", () => {
        expect(normalizeVoiceprintName("  Hara-San ")).toBe("hara-san");
    });

    it("collapses internal whitespace", () => {
        expect(normalizeVoiceprintName("Akie   Mimori")).toBe("akie mimori");
    });
});

describe("isSameVoiceprintName", () => {
    it("treats the real-world duplicates as one person", () => {
        expect(isSameVoiceprintName("Hara-San", "Hara-san")).toBe(true);
    });

    it("keeps genuinely different names apart", () => {
        // A shorter form is a judgement call, not a spelling drift, so it is
        // left to the user to merge deliberately.
        expect(isSameVoiceprintName("Akie", "Akie Mimori")).toBe(false);
    });
});

describe("isPlaceholderSpeakerName", () => {
    it.each(["Speaker 1", "speaker 12", "SPEAKER3", " Speaker 2 "])(
        "rejects %s as a name",
        (name) => {
            expect(isPlaceholderSpeakerName(name)).toBe(true);
        },
    );

    it.each(["Josh", "Speakerphone Pete", "Indy"])(
        "accepts %s as a name",
        (name) => {
            expect(isPlaceholderSpeakerName(name)).toBe(false);
        },
    );
});

describe("suggestNames", () => {
    const known = ["Justin", "Josh", "Indy", "Hara-San", "Akie Mimori"];

    it("offers the whole library alphabetically when nothing is typed", () => {
        expect(suggestNames("", known)).toEqual([
            "Akie Mimori",
            "Hara-San",
            "Indy",
            "Josh",
            "Justin",
        ]);
    });

    it("puts prefix matches before substring matches", () => {
        expect(suggestNames("j", known)).toEqual(["Josh", "Justin"]);
        expect(suggestNames("mimori", known)).toEqual(["Akie Mimori"]);
    });

    it("matches regardless of case, which is the point", () => {
        expect(suggestNames("hara-s", known)).toEqual(["Hara-San"]);
    });

    it("drops the exact name so it does not suggest what is already typed", () => {
        expect(suggestNames("Josh", known)).toEqual([]);
    });

    it("honours the limit", () => {
        expect(suggestNames("", known, 2)).toEqual(["Akie Mimori", "Hara-San"]);
    });
});
