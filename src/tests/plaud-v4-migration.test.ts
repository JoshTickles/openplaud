import { gzipSync } from "node:zlib";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi,
} from "vitest";
import { PlaudClient } from "../lib/plaud/client";

const originalFetch = global.fetch;
let mockFetch: Mock;

beforeAll(() => {
    mockFetch = vi.fn() as Mock;
    global.fetch = mockFetch as typeof global.fetch;
});

afterAll(() => {
    global.fetch = originalFetch;
});

const V4_MIGRATED = {
    status: -1800907,
    msg: "Account migrated to 4.0. Please update and reinitialize.",
};

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
    });
}

/** Enqueue JSON responses for successive fetch calls. */
function respondWith(...bodies: unknown[]) {
    for (const body of bodies) {
        mockFetch.mockResolvedValueOnce(jsonResponse(body));
    }
}

function fetchUrl(call: number): string {
    return mockFetch.mock.calls[call][0] as string;
}

describe("PlaudClient Plaud 4.0 migration", () => {
    let client: PlaudClient;

    beforeEach(() => {
        client = new PlaudClient("test-token", "https://api-apse1.plaud.ai");
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("getRecordings", () => {
        it("returns the legacy listing untouched for non-migrated accounts", async () => {
            respondWith({
                status: 0,
                msg: "success",
                data_file_total: 1,
                data_file_list: [{ id: "abc", filename: "rec", version_ms: 1 }],
            });

            const response = await client.getRecordings(0, 50);

            expect(response.data_file_list).toHaveLength(1);
            expect(response.data_file_list[0].id).toBe("abc");
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(fetchUrl(0)).toContain("/file/simple/web");
        });

        it("detects -1800907 and serves the listing from the v4 API", async () => {
            respondWith(V4_MIGRATED, {
                status: 0,
                data: {
                    items: [
                        {
                            file_id: "f_new123",
                            name: "New Recording",
                            created_at_show_ms: 1_764_000_000_000,
                            duration_ms: 60_000,
                            version_ms: 1_764_000_100_000,
                        },
                        {
                            file_id: "of_legacy456",
                            name: "Old Recording",
                            created_at_show_ms: 1_763_000_000_000,
                            duration_ms: 30_000,
                            version_ms: 1_763_000_100_000,
                        },
                    ],
                    next_cursor: null,
                },
            });

            const response = await client.getRecordings(0, 50);

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(fetchUrl(1)).toContain("/file-app/v4/recordings/all");
            expect(response.data_file_list).toHaveLength(2);
            // newest first
            expect(response.data_file_list[0].id).toBe("f_new123");
            // of_ prefix stripped so pre-migration rows keep matching
            expect(response.data_file_list[1].id).toBe("legacy456");
            expect(response.data_file_list[0].source).toBe("v4");
        });

        it("pages the v4 listing with the cursor", async () => {
            respondWith(
                V4_MIGRATED,
                {
                    status: 0,
                    data: {
                        items: Array.from({ length: 50 }, (_, i) => ({
                            file_id: `f_page0_${i}`,
                            created_at_show_ms: 1_000_000 + i,
                        })),
                        next_cursor: "CURSOR1",
                    },
                },
                {
                    status: 0,
                    data: {
                        items: [
                            {
                                file_id: "f_page1_0",
                                created_at_show_ms: 500,
                            },
                        ],
                        next_cursor: null,
                    },
                },
            );

            const response = await client.getRecordings(0, 999);

            expect(mockFetch).toHaveBeenCalledTimes(3);
            expect(fetchUrl(1)).not.toContain("cursor=");
            expect(fetchUrl(2)).toContain("cursor=CURSOR1");
            expect(response.data_file_list).toHaveLength(51);
        });

        it("throws on a non-migrated Plaud error envelope instead of switching silently", async () => {
            respondWith({ status: -401, msg: "invalid token" });

            await expect(client.getRecordings(0, 50)).rejects.toThrow(
                /invalid token/,
            );
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("reports trash listings as empty in v4 mode", async () => {
            respondWith(V4_MIGRATED, {
                status: 0,
                data: { items: [], next_cursor: null },
            });
            await client.getRecordings(0, 50);

            const trash = await client.getRecordings(0, 50, 1);
            expect(trash.data_file_list).toEqual([]);
            expect(mockFetch).toHaveBeenCalledTimes(2); // no extra call for trash
        });
    });

    describe("downloadRecording", () => {
        it("falls back to the v4 audio object when temp-url reports migration", async () => {
            const audio = Buffer.from("fake-audio-bytes");
            respondWith(
                V4_MIGRATED, // /file/temp-url
                {
                    status: 0,
                    data: {
                        meta: { file_id: "f_1" },
                        objects: [
                            {
                                object_type: "AUDIO",
                                content_url: null,
                                content_id: "c_raw",
                            },
                            {
                                object_type: "AUDIO_TRANSCODED",
                                content_url: "https://cdn.example/audio.mp3",
                                content_id: "c_tc",
                            },
                        ],
                    },
                }, // /file-app/v4/files/detail/f_1
            );
            mockFetch.mockResolvedValueOnce(
                new Response(audio, { status: 200 }),
            ); // CDN

            const buffer = await client.downloadRecording("f_1", false);

            expect(buffer).toEqual(audio);
            expect(fetchUrl(1)).toContain("/file-app/v4/files/detail/f_1");
            expect(fetchUrl(2)).toBe("https://cdn.example/audio.mp3");
            // transcode preferred: no content-url resolution needed
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it("resolves the content URL when the detail carries no presigned link", async () => {
            const audio = Buffer.from("opus-bytes");
            respondWith(
                V4_MIGRATED,
                {
                    status: 0,
                    data: {
                        objects: [
                            {
                                object_type: "AUDIO",
                                content_id: "c_1",
                            },
                        ],
                    },
                },
                {
                    status: 0,
                    data: { url_map: { c_1: "https://cdn.example/a.ogg" } },
                },
            );
            mockFetch.mockResolvedValueOnce(
                new Response(audio, { status: 200 }),
            );

            const buffer = await client.downloadRecording("f_2", false);

            expect(buffer).toEqual(audio);
            expect(fetchUrl(2)).toContain("/file-app/v4/files/content/url");
            expect(fetchUrl(3)).toBe("https://cdn.example/a.ogg");
        });

        it("throws when v4 has no downloadable audio", async () => {
            respondWith(V4_MIGRATED, { status: 0, data: { objects: [] } });

            await expect(
                client.downloadRecording("f_3", false),
            ).rejects.toThrow(/no downloadable audio/i);
        });
    });

    describe("hydrateRecording", () => {
        it("fills device serial and timing from the v4 detail", async () => {
            respondWith({
                status: 0,
                data: {
                    meta: {
                        file_id: "f_9",
                        serial_number: "SERIAL123",
                        start_time: 1_764_000_000_000,
                        duration: 120_000,
                        size_bytes: 4096,
                    },
                    objects: [
                        {
                            object_type: "AUDIO_TRANSCODED",
                            object_size: 2048,
                            content_id: "c_t",
                        },
                    ],
                },
            });

            const hydrated = await client.hydrateRecording({
                id: "f_9",
                filename: "x",
                keywords: [],
                filesize: 0,
                filetype: "",
                fullname: "",
                file_md5: "",
                ori_ready: true,
                version: 1,
                version_ms: 1,
                edit_time: 1,
                edit_from: "",
                is_trash: false,
                start_time: 0,
                end_time: 0,
                duration: 0,
                timezone: 0,
                zonemins: 0,
                scene: 0,
                filetag_id_list: [],
                serial_number: "",
                is_trans: false,
                is_summary: false,
                source: "v4",
            });

            expect(hydrated.serial_number).toBe("SERIAL123");
            expect(hydrated.start_time).toBe(1_764_000_000_000);
            expect(hydrated.duration).toBe(120_000);
            expect(hydrated.filesize).toBe(2048);
        });

        it("is a no-op for legacy listings", async () => {
            const legacy = {
                id: "abc",
                filename: "x",
                keywords: [],
                filesize: 10,
                filetype: "",
                fullname: "",
                file_md5: "",
                ori_ready: true,
                version: 1,
                version_ms: 1,
                edit_time: 1,
                edit_from: "",
                is_trash: false,
                start_time: 0,
                end_time: 0,
                duration: 0,
                timezone: 0,
                zonemins: 0,
                scene: 0,
                filetag_id_list: [],
                serial_number: "S",
                is_trans: false,
                is_summary: false,
            };

            expect(await client.hydrateRecording(legacy)).toBe(legacy);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe("fetchTranscript", () => {
        it("returns legacy trans_result unchanged for non-migrated accounts", async () => {
            respondWith({
                status: 0,
                data_file_list: [
                    {
                        id: "abc",
                        trans_result: [
                            {
                                speaker: "SPEAKER_00",
                                content: "hello",
                                start_time: 0,
                                end_time: 1,
                            },
                            {
                                speaker: "SPEAKER_00",
                                content: "again",
                                start_time: 1,
                                end_time: 2,
                            },
                            {
                                speaker: "SPEAKER_01",
                                content: "hi",
                                start_time: 2,
                                end_time: 3,
                            },
                        ],
                    },
                ],
            });

            const text = await client.fetchTranscript("abc");

            expect(text).toBe("Speaker 1: hello again\n\nSpeaker 2: hi");
        });

        it("reads the v4 TRANSCRIPT object through its gzip content link", async () => {
            const segments = [
                { speaker: "Speaker 1", content: "hello there" },
                { speaker: "Speaker 2", content: "hey" },
            ];
            respondWith(
                V4_MIGRATED, // /file/list
                {
                    status: 0,
                    data: {
                        objects: [
                            {
                                object_type: "TRANSCRIPT",
                                content_url: "https://cdn.example/t.json.gz",
                                content_id: "c_tr",
                            },
                        ],
                    },
                },
            );
            mockFetch.mockResolvedValueOnce(
                new Response(gzipSync(Buffer.from(JSON.stringify(segments))), {
                    status: 200,
                }),
            );

            const text = await client.fetchTranscript("f_5");

            expect(text).toBe("Speaker 1: hello there\n\nSpeaker 2: hey");
            expect(fetchUrl(2)).toBe("https://cdn.example/t.json.gz");
        });

        it("returns null when v4 has no transcript object yet", async () => {
            respondWith(V4_MIGRATED, {
                status: 0,
                data: {
                    objects: [{ object_type: "SUMMARY", content_url: "u" }],
                },
            });

            expect(await client.fetchTranscript("f_6")).toBeNull();
        });
    });

    describe("updateFilename", () => {
        it("renames via the v4 node API after migration", async () => {
            respondWith(
                V4_MIGRATED, // legacy PATCH
                {
                    status: 0,
                    data: {
                        node: { node_id: "n_1", name: "Old", version_ms: 7 },
                        meta: {},
                        objects: [],
                    },
                }, // v4 detail (fresh)
                { status: 0, data: { items: [], parent_items: [] } }, // rename
            );

            const result = await client.updateFilename("f_7", "New Name");

            expect(result.status).toBe(0);
            const renameCall = mockFetch.mock.calls[2];
            expect(renameCall[0]).toContain("/file-app/v4/nodes/rename/n_1");
            const body = JSON.parse(renameCall[1].body as string);
            expect(body).toEqual({ name: "New Name", origin_version: 7 });
        });
    });
});
