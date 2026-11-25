import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({ db: { select: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/auth", () => ({
    auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/plaud/client", () => ({ createPlaudClient: vi.fn() }));
vi.mock("@/lib/ai/generate-title", () => ({
    generateTitleFromTranscription: vi.fn(),
}));

import { POST } from "@/app/api/recordings/[id]/transcribe-plaud/route";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { applySpeakerMap } from "@/lib/obsidian/formatter";
import { createPlaudClient } from "@/lib/plaud/client";

function selectRows(...results: unknown[][]) {
    for (const rows of results) {
        (db.select as Mock).mockReturnValueOnce({
            from: () => ({ where: () => ({ limit: async () => rows }) }),
        });
    }
}

describe("Plaud transcript replacement", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (auth.api.getSession as unknown as Mock).mockResolvedValue({
            user: { id: "user-1" },
        });
    });

    it("clears old speaker and backend metadata without rewriting Plaud labels", async () => {
        const plaudText = "Speaker 1: Hello Josh.\n\nJosh: Hello.";
        const old = {
            id: "trans-1",
            text: "Speaker 1: Old words.",
            speakerMap: { "Speaker 1": "Josh" },
            speakerCentroids: { "Speaker 1": [0.5] },
            speakerSegments: { "Speaker 1": { start: 1, end: 2 } },
            transcriptionBackend: "litellm",
        };
        selectRows(
            [{ id: "rec-1", plaudFileId: "file-1", duration: 60_000 }],
            [{ bearerToken: "token", apiBase: "https://example.test" }],
            [old],
            [{ autoGenerateTitle: false }],
        );
        (createPlaudClient as Mock).mockResolvedValue({
            fetchTranscript: vi.fn().mockResolvedValue(plaudText),
        });
        const set = vi
            .fn()
            .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        (db.update as Mock).mockReturnValue({ set });

        const response = await POST(
            new Request(
                "http://localhost/api/recordings/rec-1/transcribe-plaud",
                {
                    method: "POST",
                },
            ),
            { params: Promise.resolve({ id: "rec-1" }) },
        );

        expect(response.status).toBe(200);
        expect((await response.json()).transcription).toBe(plaudText);
        expect(set).toHaveBeenCalledWith({
            text: plaudText,
            detectedLanguage: null,
            transcriptionType: "server",
            provider: "plaud",
            model: "plaud-cloud",
            transcriptionBackend: null,
            speakerMap: null,
            speakerCentroids: null,
            speakerSegments: null,
        });
        const replacement = { ...old, ...set.mock.calls[0][0] };
        expect(applySpeakerMap(replacement.text, replacement.speakerMap)).toBe(
            plaudText,
        );
        expect(applySpeakerMap(plaudText, old.speakerMap)).not.toBe(plaudText);
    });
});
