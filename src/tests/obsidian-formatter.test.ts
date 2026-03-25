import { describe, expect, it } from "vitest";
import {
    applySpeakerMap,
    escapeYaml,
    formatDuration,
    formatTranscriptMarkdown,
    generateVaultPath,
} from "@/lib/obsidian/formatter";

describe("formatDuration", () => {
    it("formats seconds only", () => {
        expect(formatDuration(45000)).toBe("0m 45s");
    });

    it("formats minutes and seconds", () => {
        expect(formatDuration(125000)).toBe("2m 5s");
    });

    it("formats hours, minutes, and seconds", () => {
        expect(formatDuration(3661000)).toBe("1h 1m 1s");
    });

    it("handles zero", () => {
        expect(formatDuration(0)).toBe("0m 0s");
    });
});

describe("escapeYaml", () => {
    it("returns plain string unchanged", () => {
        expect(escapeYaml("hello world")).toBe("hello world");
    });

    it("quotes strings with colons", () => {
        expect(escapeYaml("key: value")).toBe('"key: value"');
    });

    it("quotes strings with special yaml characters", () => {
        for (const char of [":", "{", "}", "[", "]", "*", "?", "|", ">", "!", "%", "@", "#"]) {
            expect(escapeYaml(`has${char}char`)).toMatch(/^"/);
        }
    });

    it("quotes strings starting with single quote", () => {
        expect(escapeYaml("'quoted'")).toBe("\"'quoted'\"");
    });

    it("escapes embedded double quotes", () => {
        expect(escapeYaml('say "hello"')).toBe('"say \\"hello\\""');
    });

    it("does not quote simple alphanumeric strings", () => {
        expect(escapeYaml("Speaker 1")).toBe("Speaker 1");
    });
});

describe("applySpeakerMap", () => {
    it("replaces speaker labels with real names", () => {
        const text = "Speaker 1: Hello\nSpeaker 2: Hi";
        const map = { "Speaker 1": "Alice", "Speaker 2": "Bob" };
        expect(applySpeakerMap(text, map)).toBe("Alice: Hello\nBob: Hi");
    });

    it("returns text unchanged when map is null", () => {
        expect(applySpeakerMap("Speaker 1: Hi", null)).toBe("Speaker 1: Hi");
    });

    it("returns text unchanged when map is empty", () => {
        expect(applySpeakerMap("Speaker 1: Hi", {})).toBe("Speaker 1: Hi");
    });

    it("skips entries with empty/whitespace names", () => {
        const map = { "Speaker 1": "Alice", "Speaker 2": "  " };
        const text = "Speaker 1: A\nSpeaker 2: B";
        const result = applySpeakerMap(text, map);
        expect(result).toContain("Alice: A");
        expect(result).toContain("Speaker 2: B");
    });

    it("replaces case-insensitively", () => {
        const result = applySpeakerMap("speaker 1: hello", { "Speaker 1": "Alice" });
        expect(result).toBe("Alice: hello");
    });

    it("applies longer labels first to avoid partial matches", () => {
        const map = { "Speaker 1": "Alice", "Speaker 10": "Zara" };
        const text = "Speaker 10: first\nSpeaker 1: second";
        const result = applySpeakerMap(text, map);
        expect(result).toContain("Zara: first");
        expect(result).toContain("Alice: second");
    });
});

describe("generateVaultPath", () => {
    const date = new Date("2026-03-25T00:00:00Z");

    it("builds path from base and title", () => {
        expect(generateVaultPath("/vault/notes", "My Recording", date)).toBe(
            "/vault/notes/My Recording.md",
        );
    });

    it("strips trailing slash from base", () => {
        expect(generateVaultPath("/vault/notes/", "Test", date)).toBe(
            "/vault/notes/Test.md",
        );
    });

    it("replaces forbidden filename characters with dashes", () => {
        expect(generateVaultPath("/vault", 'A:B<C>D"E', date)).toBe(
            "/vault/A-B-C-D-E.md",
        );
    });

    it("collapses multiple spaces to single space", () => {
        expect(generateVaultPath("/vault", "Too   many   spaces", date)).toBe(
            "/vault/Too many spaces.md",
        );
    });

    it("trims whitespace from title", () => {
        expect(generateVaultPath("/vault", "  Padded  ", date)).toBe(
            "/vault/Padded.md",
        );
    });
});

describe("formatTranscriptMarkdown", () => {
    const baseMetadata = {
        title: "Test Recording",
        date: new Date("2026-03-25T10:00:00Z"),
        recordingId: "rec-123",
    };

    it("includes YAML frontmatter with required fields", () => {
        const result = formatTranscriptMarkdown("Hello world", baseMetadata);
        expect(result).toMatch(/^---\n/);
        expect(result).toContain("title: Test Recording");
        expect(result).toContain("recording_id: rec-123");
        expect(result).toContain("source: plaud");
    });

    it("includes default tags (transcription, plaud)", () => {
        const result = formatTranscriptMarkdown("text", baseMetadata);
        expect(result).toContain("  - transcription");
        expect(result).toContain("  - plaud");
    });

    it("includes custom tags alongside defaults", () => {
        const result = formatTranscriptMarkdown("text", {
            ...baseMetadata,
            tags: ["meeting", "important"],
        });
        expect(result).toContain("  - meeting");
        expect(result).toContain("  - important");
        expect(result).toContain("  - transcription");
    });

    it("includes speaker map in frontmatter and applies to body", () => {
        const result = formatTranscriptMarkdown("Speaker 1: Hi", {
            ...baseMetadata,
            speakerMap: { "Speaker 1": "Alice" },
        });
        expect(result).toContain("speakers:");
        expect(result).toContain("  Speaker 1: Alice");
        expect(result).toContain("Alice: Hi");
    });

    it("skips empty speaker names in frontmatter", () => {
        const result = formatTranscriptMarkdown("text", {
            ...baseMetadata,
            speakerMap: { "Speaker 1": "Alice", "Speaker 2": "" },
        });
        expect(result).toContain("Speaker 1: Alice");
        expect(result).not.toMatch(/Speaker 2:/);
    });

    it("includes summary section when provided", () => {
        const result = formatTranscriptMarkdown("text", {
            ...baseMetadata,
            summary: "A brief summary",
        });
        expect(result).toContain("## Summary");
        expect(result).toContain("A brief summary");
    });

    it("includes key points as bullet list", () => {
        const result = formatTranscriptMarkdown("text", {
            ...baseMetadata,
            keyPoints: ["Point one", "Point two"],
        });
        expect(result).toContain("## Key Points");
        expect(result).toContain("- Point one");
        expect(result).toContain("- Point two");
    });

    it("includes action items as checkboxes", () => {
        const result = formatTranscriptMarkdown("text", {
            ...baseMetadata,
            actionItems: ["Do this", "Do that"],
        });
        expect(result).toContain("## Action Items");
        expect(result).toContain("- [ ] Do this");
        expect(result).toContain("- [ ] Do that");
    });

    it("includes duration when provided", () => {
        const result = formatTranscriptMarkdown("text", {
            ...baseMetadata,
            duration: 125000,
        });
        expect(result).toContain("duration: 125000");
        expect(result).toContain("duration_formatted: 2m 5s");
    });

    it("omits optional sections when data is missing", () => {
        const result = formatTranscriptMarkdown("text", baseMetadata);
        expect(result).not.toContain("## Summary");
        expect(result).not.toContain("## Key Points");
        expect(result).not.toContain("## Action Items");
        expect(result).not.toContain("speakers:");
        expect(result).not.toContain("duration:");
    });

    it("ends with a trailing newline", () => {
        const result = formatTranscriptMarkdown("text", baseMetadata);
        expect(result).toMatch(/\n$/);
    });
});
