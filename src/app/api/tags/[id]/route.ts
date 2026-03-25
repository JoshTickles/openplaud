import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordingTags } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id } = await params;
        const body = await request.json();
        const { name, color } = body;

        const updates: Record<string, string> = {};

        if (name !== undefined) {
            if (typeof name !== "string" || name.trim().length === 0) {
                return NextResponse.json(
                    { error: "Tag name cannot be empty" },
                    { status: 400 },
                );
            }
            updates.name = name.trim().substring(0, 50);
        }

        if (color !== undefined) {
            if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
                return NextResponse.json(
                    { error: "Color must be a valid hex color (e.g. #3b82f6)" },
                    { status: 400 },
                );
            }
            updates.color = color;
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json(
                { error: "No updates provided" },
                { status: 400 },
            );
        }

        const [tag] = await db
            .update(recordingTags)
            .set(updates)
            .where(
                and(
                    eq(recordingTags.id, id),
                    eq(recordingTags.userId, session.user.id),
                ),
            )
            .returning();

        if (!tag) {
            return NextResponse.json(
                { error: "Tag not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({ tag });
    } catch (error) {
        const msg = String((error as Error).message || "");
        if (msg.includes("unique") || msg.includes("duplicate")) {
            return NextResponse.json(
                { error: "A tag with that name already exists" },
                { status: 409 },
            );
        }
        console.error("Error updating tag:", error);
        return NextResponse.json(
            { error: "Failed to update tag" },
            { status: 500 },
        );
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { id } = await params;

        const [deleted] = await db
            .delete(recordingTags)
            .where(
                and(
                    eq(recordingTags.id, id),
                    eq(recordingTags.userId, session.user.id),
                ),
            )
            .returning();

        if (!deleted) {
            return NextResponse.json(
                { error: "Tag not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting tag:", error);
        return NextResponse.json(
            { error: "Failed to delete tag" },
            { status: 500 },
        );
    }
}
