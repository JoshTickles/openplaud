import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        DEFAULT_STORAGE_TYPE: "local",
        ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
}));

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/plaud/client", () => ({
    createPlaudClient: vi.fn(),
}));

vi.mock("@/lib/storage/factory", () => ({
    createUserStorageProvider: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue(undefined),
        downloadFile: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
    }),
}));

vi.mock("@/lib/notifications/bark", () => ({
    sendNewRecordingBarkNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/notifications/email", () => ({
    sendNewRecordingEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/transcription/transcribe-recording", () => ({
    transcribeRecording: vi.fn().mockResolvedValue({ success: true }),
}));

import { db } from "@/db";
import { createPlaudClient } from "@/lib/plaud/client";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

describe("Sync", () => {
    const mockUserId = "user-123";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("syncRecordingsForUser", () => {
        it("should return error when no Plaud connection found", async () => {
            (db.select as Mock).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.errors).toContain("No Plaud connection found");
            expect(result.newRecordings).toBe(0);
        });

        it("should skip already synced recordings with same version", async () => {
            const mockConnection = {
                id: "conn-1",
                userId: mockUserId,
                bearerToken: "encrypted-token",
            };

            const mockExistingRecording = {
                id: "local-rec-1",
                plaudFileId: "plaud-1",
                plaudVersion: "1000",
            };

            const mockPlaudRecordings = [
                {
                    id: "plaud-1",
                    filename: "Recording 1.mp3",
                    duration: 60000,
                    start_time: "2024-01-01T10:00:00Z",
                    end_time: "2024-01-01T10:01:00Z",
                    filesize: 1024000,
                    file_md5: "abc123",
                    serial_number: "SN123",
                    version_ms: 1000,
                    timezone: 0,
                    zonemins: 0,
                    scene: 0,
                    is_trash: false,
                },
            ];

            const mockPlaudClient = {
                getRecordings: vi.fn().mockResolvedValue({
                    data_file_list: mockPlaudRecordings,
                }),
                hydrateRecording: vi
                    .fn()
                    .mockImplementation(async (r: unknown) => r),
                downloadRecording: vi
                    .fn()
                    .mockResolvedValue(Buffer.from("audio")),
            };

            (createPlaudClient as Mock).mockResolvedValue(mockPlaudClient);

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockConnection]),
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
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { email: "test@example.com" },
                                ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([mockExistingRecording]),
                        }),
                    }),
                });

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.newRecordings).toBe(0);
            expect(result.updatedRecordings).toBe(0);
        });

        it("should update recordings with newer version", async () => {
            const mockConnection = {
                id: "conn-1",
                userId: mockUserId,
                bearerToken: "encrypted-token",
            };

            const mockExistingRecording = {
                id: "local-rec-1",
                plaudFileId: "plaud-1",
                plaudVersion: "500",
            };

            const mockPlaudRecordings = [
                {
                    id: "plaud-1",
                    filename: "Recording 1.mp3",
                    duration: 60000,
                    start_time: "2024-01-01T10:00:00Z",
                    end_time: "2024-01-01T10:01:00Z",
                    filesize: 1024000,
                    file_md5: "abc123",
                    serial_number: "SN123",
                    version_ms: 2000,
                    timezone: 0,
                    zonemins: 0,
                    scene: 0,
                    is_trash: false,
                },
            ];

            const mockPlaudClient = {
                getRecordings: vi.fn().mockResolvedValue({
                    data_file_list: mockPlaudRecordings,
                }),
                hydrateRecording: vi
                    .fn()
                    .mockImplementation(async (r: unknown) => r),
                downloadRecording: vi
                    .fn()
                    .mockResolvedValue(Buffer.from("audio")),
            };

            (createPlaudClient as Mock).mockResolvedValue(mockPlaudClient);

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockConnection]),
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
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { email: "test@example.com" },
                                ]),
                        }),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([mockExistingRecording]),
                        }),
                    }),
                });

            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.newRecordings).toBe(0);
            expect(result.updatedRecordings).toBe(1);
        });

        it("should return error when sync fails", async () => {
            const mockConnection = {
                id: "conn-1",
                userId: mockUserId,
                bearerToken: "encrypted-token",
            };

            (db.select as Mock)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([mockConnection]),
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
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi
                                .fn()
                                .mockResolvedValue([
                                    { email: "test@example.com" },
                                ]),
                        }),
                    }),
                });

            (createPlaudClient as Mock).mockRejectedValue(
                new Error("Connection failed"),
            );

            const result = await syncRecordingsForUser(mockUserId);

            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe("upstream deletion flagging", () => {
        const page = (ids: string[]) => ({
            data_file_list: ids.map((id, i) => ({
                id,
                filename: `${id}.mp3`,
                duration: 60000,
                start_time: 1000 + i,
                end_time: 61000 + i,
                filesize: 1024,
                file_md5: "md5",
                serial_number: "SN",
                version_ms: 1,
                timezone: 0,
                zonemins: 0,
                scene: 0,
                is_trash: false,
            })),
        });

        // Full-page recordings every time, all already synced (skip path),
        // so pagination stops on the two-idle-page early exit rather than
        // at a short final page.
        function setupIdleSync(pageCount: number) {
            const pageSize = 50;
            const mockConnection = {
                id: "conn-1",
                userId: mockUserId,
                bearerToken: "encrypted-token",
            };

            const client = {
                getRecordings: vi.fn(),
                hydrateRecording: vi
                    .fn()
                    .mockImplementation(async (r: unknown) => r),
                downloadRecording: vi
                    .fn()
                    .mockResolvedValue(Buffer.from("audio")),
                usingPlaudV4: false,
            };

            for (let p = 0; p < pageCount; p++) {
                const ids = Array.from(
                    { length: pageSize },
                    (_, i) => `plaud-p${p}-${i}`,
                );
                client.getRecordings.mockResolvedValueOnce(page(ids));
            }

            (createPlaudClient as Mock).mockResolvedValue(client);

            const selectFor = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue(rows),
                    }),
                }),
            });
            // connection, settings, user, then one existing (up-to-date)
            // recording lookup per processed recording.
            (db.select as Mock).mockReturnValueOnce(selectFor([mockConnection]));
            (db.select as Mock).mockReturnValueOnce(
                selectFor([{ id: "settings-1" }]),
            );
            (db.select as Mock).mockReturnValueOnce(
                selectFor([{ email: "test@example.com" }]),
            );
            (db.select as Mock).mockImplementation(() => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                id: "local",
                                plaudVersion: "1",
                            },
                        ]),
                    }),
                }),
            }));

            const updateWhere = vi.fn().mockResolvedValue(undefined);
            const updateSet = vi
                .fn()
                .mockReturnValue({ where: updateWhere });
            (db.update as Mock).mockReturnValue({ set: updateSet });

            return { client, updateSet, updateWhere };
        }

        it("does not flag upstream-deleted after an early-exit partial listing", async () => {
            const { client, updateSet } = setupIdleSync(3);

            const result = await syncRecordingsForUser(mockUserId);

            // Early exit after two idle pages; listing was never exhausted.
            expect(result.removedRecordings).toBe(0);
            expect(client.getRecordings.mock.calls.length).toBeLessThan(3);
            // The only update is lastSync; nothing sets upstreamDeleted.
            const flagged = updateSet.mock.calls.some(
                ([patch]) => "upstreamDeleted" in patch,
            );
            expect(flagged).toBe(false);
        });

        it("completes the seen set from the cached v4 listing and flags", async () => {
            // Two queued idle pages: the loop early-exits, the third queued
            // mock is the completion call.
            const { client } = setupIdleSync(2);
            client.usingPlaudV4 = true;
            // The completion call returns the full listing (cache hit).
            const allIds = Array.from(
                { length: 230 },
                (_, i) => `plaud-p${Math.floor(i / 50)}-${i % 50}`,
            );
            client.getRecordings.mockResolvedValueOnce(page(allIds));
            const updateSet = vi.fn();
            const updateWhere = vi
                .fn()
                .mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
            updateSet.mockReturnValue({ where: updateWhere });
            (db.update as Mock).mockReturnValue({ set: updateSet });

            const result = await syncRecordingsForUser(mockUserId);

            // Full set seen: deletion flagging is allowed to run.
            const completionCall = client.getRecordings.mock.calls.at(-1);
            expect(completionCall?.[0]).toBe(0);
            const flagCalls = updateSet.mock.calls.filter(
                ([patch]) => patch.upstreamDeleted === true,
            );
            expect(flagCalls.length).toBe(1);
            expect(result.removedRecordings).toBe(0);
        });
    });
});
