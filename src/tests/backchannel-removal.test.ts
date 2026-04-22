import { describe, expect, it } from "vitest";
import { removeBackchannelTurns } from "@/lib/transcription/providers/google-speech-provider";

describe("removeBackchannelTurns", () => {
    it("removes 'Yeah.' backchannel turns", () => {
        const input = [
            "Speaker 1: So what do you think about that?",
            "",
            "Speaker 3: Yeah.",
            "",
            "Speaker 2: I think it's a good idea.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe([
            "Speaker 1: So what do you think about that?",
            "",
            "Speaker 2: I think it's a good idea.",
        ].join("\n"));
    });

    it("removes 'Mm-hmm.' backchannel turns", () => {
        const input = [
            "Speaker 1: We need to talk about the project.",
            "",
            "Speaker 2: Mm-hmm.",
            "",
            "Speaker 1: It's going well so far.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe([
            "Speaker 1: We need to talk about the project.",
            "",
            "Speaker 1: It's going well so far.",
        ].join("\n"));
    });

    it("removes multiple consecutive backchannels", () => {
        const input = [
            "Speaker 1: Long explanation here.",
            "",
            "Speaker 3: Yeah.",
            "",
            "Speaker 3: Mm-hmm.",
            "",
            "Speaker 3: Right.",
            "",
            "Speaker 1: And then we moved on.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe([
            "Speaker 1: Long explanation here.",
            "",
            "Speaker 1: And then we moved on.",
        ].join("\n"));
    });

    it("preserves substantive turns even with backchannel words", () => {
        const input = [
            "Speaker 1: What happened next?",
            "",
            "Speaker 2: Yeah, I mean, it was expected, at least from my point of view.",
            "",
            "Speaker 3: Yeah.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe([
            "Speaker 1: What happened next?",
            "",
            "Speaker 2: Yeah, I mean, it was expected, at least from my point of view.",
        ].join("\n"));
    });

    it("handles 'yeah yeah' and 'yeah, yeah' as backchannels", () => {
        const input = [
            "Speaker 1: So that's the plan.",
            "",
            "Speaker 3: Yeah, yeah.",
            "",
            "Speaker 2: Sounds good to me.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe([
            "Speaker 1: So that's the plan.",
            "",
            "Speaker 2: Sounds good to me.",
        ].join("\n"));
    });

    it("handles 'absolutely' and 'exactly' as backchannels", () => {
        const input = [
            "Speaker 1: We've had a good run.",
            "",
            "Speaker 3: Yeah, absolutely.",
            "",
            "Speaker 1: And now things are changing.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe([
            "Speaker 1: We've had a good run.",
            "",
            "Speaker 1: And now things are changing.",
        ].join("\n"));
    });

    it("does not remove turns with real content starting with backchannel words", () => {
        const input = [
            "Speaker 1: Did you see that?",
            "",
            "Speaker 2: Yeah, I saw it and I think we should act on it immediately.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe(input);
    });

    it("returns text as-is when no backchannels present", () => {
        const input = [
            "Speaker 1: Hello, how are you?",
            "",
            "Speaker 2: I'm doing well, thanks for asking.",
            "",
            "Speaker 1: Great to hear.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe(input);
    });

    it("returns empty string for empty input", () => {
        expect(removeBackchannelTurns("")).toBe("");
    });

    it("handles the real-world pattern from the bug report", () => {
        const input = [
            "Speaker 1: One thing to keep in mind is that usually founders set up companies, take it to a certain point, and then they leave.",
            "",
            "Speaker 3: Yeah.",
            "",
            "Speaker 1: Most founders.",
            "",
            "Speaker 3: Yeah, absolutely.",
            "",
            "Speaker 1: So we've had a fairly good run with both Grant and Marin.",
            "",
            "Speaker 3: Yeah, absolutely.",
            "",
            "Speaker 1: And now, yeah, I think Grant is now focused on doing his...",
            "",
            "Speaker 3: Yeah.",
            "",
            "Speaker 1: ...new AI agents kind of project.",
            "",
            "Speaker 3: Mm-hmm.",
            "",
            "Speaker 1: Um, so I think Marin is joining him.",
            "",
            "Speaker 3: Right.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe([
            "Speaker 1: One thing to keep in mind is that usually founders set up companies, take it to a certain point, and then they leave.",
            "",
            "Speaker 1: Most founders.",
            "",
            "Speaker 1: So we've had a fairly good run with both Grant and Marin.",
            "",
            "Speaker 1: And now, yeah, I think Grant is now focused on doing his...",
            "",
            "Speaker 1: ...new AI agents kind of project.",
            "",
            "Speaker 1: Um, so I think Marin is joining him.",
        ].join("\n"));
    });

    it("does not remove 'no' when it's part of a sentence", () => {
        const input = [
            "Speaker 1: Should we do that?",
            "",
            "Speaker 2: No, I don't think that's the right approach at all.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe(input);
    });

    it("removes bare 'no' as a backchannel", () => {
        const input = [
            "Speaker 1: Was that the right call?",
            "",
            "Speaker 3: No.",
            "",
            "Speaker 1: Well, I think it was.",
        ].join("\n");
        const result = removeBackchannelTurns(input);
        expect(result).toBe([
            "Speaker 1: Was that the right call?",
            "",
            "Speaker 1: Well, I think it was.",
        ].join("\n"));
    });
});
