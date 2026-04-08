import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/env", () => ({
    env: {
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    }),
}));

vi.mock("openai", () => {
    // Return object explicitly — bun's vi.fn doesn't propagate `this`
    // correctly for constructor calls.
    const MockOpenAI = vi.fn(() => ({
        audio: {
            transcriptions: {
                // Default: reject so the "API call fails" test works.
                // Earlier tests short-circuit before reaching this mock.
                create: vi.fn().mockRejectedValue(new Error("API Error")),
            },
        },
    }));
    const toFile = vi.fn(async (buffer: unknown, name: string, opts: unknown) =>
        new File([buffer as BlobPart], name, opts as FilePropertyBag),
    );
    return { OpenAI: MockOpenAI, toFile };
});

import { db } from "@/db";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

describe("Transcription", () => {
    const mockUserId = "user-123";
    const mockRecordingId = "rec-456";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("transcribeRecording", () => {
        it("should return error when recording not found", async () => {
            (db.select as Mock).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Recording not found");
        });

        it("should return success when transcription already exists", async () => {
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { id: "trans-1", text: "Existing text" },
                                ]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(true);
        });

        it("should return error when no API credentials configured", async () => {
            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("No transcription API configured");
        });

        it("should return error when API call fails", async () => {

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: mockRecordingId,
                                    filename: "test.mp3",
                                    storagePath: "test.mp3",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                {
                                    id: "creds-1",
                                    provider: "openai",
                                    apiKey: "e33720d13630d82e0a779e12eae27440:0639afbd99d5585f8096086114e351f7:122f3fce3b4a83afaab5937a",
                                    defaultModel: "whisper-1",
                                },
                            ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([{ id: "settings-1" }]),
                        }),
                    }),
                });

            const result = await transcribeRecording(
                mockUserId,
                mockRecordingId,
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("API Error");
        });
    });
});
