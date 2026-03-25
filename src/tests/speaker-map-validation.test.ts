import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock("@/lib/auth", () => ({
    auth: {
        api: {
            getSession: vi.fn(),
        },
    },
}));

import { db } from "@/db";
import { auth } from "@/lib/auth";

import { GET, PATCH } from "@/app/api/recordings/[id]/speaker-map/route";

function makeRequest(method: string, body?: unknown): Request {
    return new Request("http://localhost/api/recordings/rec-1/speaker-map", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

function makeParams(id: string) {
    return { params: Promise.resolve({ id }) };
}

function mockDbSelectChain(...results: unknown[][]) {
    let mock = db.select as Mock;
    for (const result of results) {
        mock = mock.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(result),
                }),
            }),
        }) as unknown as Mock;
    }
}

describe("Speaker Map API validation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (auth.api.getSession as Mock).mockResolvedValue({
            user: { id: "user-1" },
        });
    });

    describe("GET /api/recordings/[id]/speaker-map", () => {
        it("returns 401 when not authenticated", async () => {
            (auth.api.getSession as Mock).mockResolvedValue(null);
            const res = await GET(makeRequest("GET"), makeParams("rec-1"));
            expect(res.status).toBe(401);
        });

        it("returns 404 when recording not found", async () => {
            mockDbSelectChain([]);
            const res = await GET(makeRequest("GET"), makeParams("rec-1"));
            expect(res.status).toBe(404);
        });

        it("returns null when no transcription exists", async () => {
            mockDbSelectChain([{ id: "rec-1" }], []);
            const res = await GET(makeRequest("GET"), makeParams("rec-1"));
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.speakerMap).toBeNull();
        });

        it("returns speaker map when it exists", async () => {
            const map = { "Speaker 1": "Alice" };
            mockDbSelectChain([{ id: "rec-1" }], [{ speakerMap: map }]);
            const res = await GET(makeRequest("GET"), makeParams("rec-1"));
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.speakerMap).toEqual(map);
        });
    });

    describe("PATCH /api/recordings/[id]/speaker-map", () => {
        it("returns 401 when not authenticated", async () => {
            (auth.api.getSession as Mock).mockResolvedValue(null);
            const res = await PATCH(
                makeRequest("PATCH", { speakerMap: {} }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(401);
        });

        it("rejects null speakerMap", async () => {
            const res = await PATCH(
                makeRequest("PATCH", { speakerMap: null }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toContain("must be an object");
        });

        it("rejects missing speakerMap", async () => {
            const res = await PATCH(
                makeRequest("PATCH", {}),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(400);
        });

        it("rejects non-object speakerMap", async () => {
            const res = await PATCH(
                makeRequest("PATCH", { speakerMap: "not an object" }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(400);
        });

        it("rejects speaker names longer than 100 characters", async () => {
            const res = await PATCH(
                makeRequest("PATCH", {
                    speakerMap: { "Speaker 1": "A".repeat(101) },
                }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toContain("100 characters");
        });

        it("accepts exactly 100 character speaker name", async () => {
            mockDbSelectChain([{ id: "rec-1" }]);
            (db.select as Mock).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ id: "trans-1" }]),
                    }),
                }),
            });
            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            const res = await PATCH(
                makeRequest("PATCH", {
                    speakerMap: { "Speaker 1": "A".repeat(100) },
                }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(200);
        });

        it("returns 404 when recording not found", async () => {
            mockDbSelectChain([]);
            const res = await PATCH(
                makeRequest("PATCH", {
                    speakerMap: { "Speaker 1": "Alice" },
                }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error).toContain("Recording not found");
        });

        it("returns 404 when no transcription exists", async () => {
            mockDbSelectChain([{ id: "rec-1" }], []);

            const res = await PATCH(
                makeRequest("PATCH", {
                    speakerMap: { "Speaker 1": "Alice" },
                }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error).toContain("No transcription");
        });

        it("accepts valid speaker map and saves", async () => {
            mockDbSelectChain([{ id: "rec-1" }]);
            (db.select as Mock).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ id: "trans-1" }]),
                    }),
                }),
            });
            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            const map = { "Speaker 1": "Alice", "Speaker 2": "Bob" };
            const res = await PATCH(
                makeRequest("PATCH", { speakerMap: map }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.speakerMap).toEqual(map);
        });

        it("accepts empty speaker map (clears names)", async () => {
            mockDbSelectChain([{ id: "rec-1" }]);
            (db.select as Mock).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ id: "trans-1" }]),
                    }),
                }),
            });
            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            const res = await PATCH(
                makeRequest("PATCH", { speakerMap: {} }),
                makeParams("rec-1"),
            );
            expect(res.status).toBe(200);
        });
    });
});
