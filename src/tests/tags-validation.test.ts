import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
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

import { POST } from "@/app/api/tags/route";
import { DELETE, PATCH } from "@/app/api/tags/[id]/route";

function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

function makeParams(id: string) {
    return { params: Promise.resolve({ id }) };
}

describe("Tags API validation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (auth.api.getSession as Mock).mockResolvedValue({
            user: { id: "user-1" },
        });
    });

    describe("POST /api/tags", () => {
        it("rejects missing name", async () => {
            const res = await POST(makeRequest({}));
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toContain("name is required");
        });

        it("rejects empty string name", async () => {
            const res = await POST(makeRequest({ name: "  " }));
            expect(res.status).toBe(400);
        });

        it("rejects non-string name", async () => {
            const res = await POST(makeRequest({ name: 123 }));
            expect(res.status).toBe(400);
        });

        it("rejects invalid hex color", async () => {
            const res = await POST(makeRequest({ name: "Work", color: "red" }));
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toContain("hex color");
        });

        it("rejects short hex color", async () => {
            const res = await POST(makeRequest({ name: "Work", color: "#abc" }));
            expect(res.status).toBe(400);
        });

        it("rejects hex without hash", async () => {
            const res = await POST(makeRequest({ name: "Work", color: "3b82f6" }));
            expect(res.status).toBe(400);
        });

        it("accepts valid name and color", async () => {
            (db.insert as Mock).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([
                        { id: "tag-1", name: "Work", color: "#3b82f6" },
                    ]),
                }),
            });

            const res = await POST(makeRequest({ name: "Work", color: "#3b82f6" }));
            expect(res.status).toBe(201);
        });

        it("accepts name without color", async () => {
            (db.insert as Mock).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([
                        { id: "tag-1", name: "Work", color: null },
                    ]),
                }),
            });

            const res = await POST(makeRequest({ name: "Work" }));
            expect(res.status).toBe(201);
        });

        it("truncates name to 50 characters", async () => {
            const longName = "A".repeat(60);
            (db.insert as Mock).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([
                        { id: "tag-1", name: longName.substring(0, 50) },
                    ]),
                }),
            });

            const res = await POST(makeRequest({ name: longName }));
            expect(res.status).toBe(201);
            const insertCall = (db.insert as Mock).mock.results[0].value.values;
            const args = insertCall.mock.calls[0][0];
            expect(args.name.length).toBe(50);
        });

        it("returns 409 on duplicate name", async () => {
            (db.insert as Mock).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockRejectedValue(
                        new Error("unique constraint violation"),
                    ),
                }),
            });

            const res = await POST(makeRequest({ name: "Work" }));
            expect(res.status).toBe(409);
        });

        it("returns 401 when not authenticated", async () => {
            (auth.api.getSession as Mock).mockResolvedValue(null);
            const res = await POST(makeRequest({ name: "Work" }));
            expect(res.status).toBe(401);
        });
    });

    describe("PATCH /api/tags/[id]", () => {
        it("rejects empty updates", async () => {
            const req = new Request("http://localhost/api/tags/tag-1", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const res = await PATCH(req, makeParams("tag-1"));
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toContain("No updates");
        });

        it("rejects empty name string", async () => {
            const req = new Request("http://localhost/api/tags/tag-1", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "" }),
            });
            const res = await PATCH(req, makeParams("tag-1"));
            expect(res.status).toBe(400);
        });

        it("rejects invalid color on update", async () => {
            const req = new Request("http://localhost/api/tags/tag-1", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ color: "notacolor" }),
            });
            const res = await PATCH(req, makeParams("tag-1"));
            expect(res.status).toBe(400);
        });

        it("returns 404 when tag not found", async () => {
            (db.update as Mock).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const req = new Request("http://localhost/api/tags/tag-1", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Updated" }),
            });
            const res = await PATCH(req, makeParams("tag-1"));
            expect(res.status).toBe(404);
        });
    });

    describe("DELETE /api/tags/[id]", () => {
        it("returns 404 when tag not found", async () => {
            (db.delete as Mock).mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            });

            const req = new Request("http://localhost/api/tags/tag-1", {
                method: "DELETE",
            });
            const res = await DELETE(req, makeParams("tag-1"));
            expect(res.status).toBe(404);
        });

        it("returns success when tag deleted", async () => {
            (db.delete as Mock).mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: "tag-1" }]),
                }),
            });

            const req = new Request("http://localhost/api/tags/tag-1", {
                method: "DELETE",
            });
            const res = await DELETE(req, makeParams("tag-1"));
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
        });

        it("returns 401 when not authenticated", async () => {
            (auth.api.getSession as Mock).mockResolvedValue(null);
            const req = new Request("http://localhost/api/tags/tag-1", {
                method: "DELETE",
            });
            const res = await DELETE(req, makeParams("tag-1"));
            expect(res.status).toBe(401);
        });
    });
});
