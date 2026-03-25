import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, recordingTagAssignments, recordingTags } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function GET(
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

        const assignments = await db
            .select({
                id: recordingTags.id,
                name: recordingTags.name,
                color: recordingTags.color,
            })
            .from(recordingTagAssignments)
            .innerJoin(
                recordingTags,
                eq(recordingTagAssignments.tagId, recordingTags.id),
            )
            .where(eq(recordingTagAssignments.recordingId, id));

        return NextResponse.json({ tags: assignments });
    } catch (error) {
        console.error("Error fetching recording tags:", error);
        return NextResponse.json(
            { error: "Failed to fetch recording tags" },
            { status: 500 },
        );
    }
}

export async function PUT(
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
        const { tagIds } = body;

        if (!Array.isArray(tagIds)) {
            return NextResponse.json(
                { error: "tagIds must be an array" },
                { status: 400 },
            );
        }

        const [recording] = await db
            .select({ id: recordings.id })
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Recording not found" },
                { status: 404 },
            );
        }

        if (tagIds.length > 0) {
            const validTags = await db
                .select({ id: recordingTags.id })
                .from(recordingTags)
                .where(
                    and(
                        eq(recordingTags.userId, session.user.id),
                        inArray(recordingTags.id, tagIds),
                    ),
                );

            if (validTags.length !== tagIds.length) {
                return NextResponse.json(
                    { error: "One or more tag IDs are invalid" },
                    { status: 400 },
                );
            }
        }

        await db
            .delete(recordingTagAssignments)
            .where(eq(recordingTagAssignments.recordingId, id));

        if (tagIds.length > 0) {
            await db.insert(recordingTagAssignments).values(
                tagIds.map((tagId: string) => ({
                    recordingId: id,
                    tagId,
                })),
            );
        }

        const updatedTags = await db
            .select({
                id: recordingTags.id,
                name: recordingTags.name,
                color: recordingTags.color,
            })
            .from(recordingTagAssignments)
            .innerJoin(
                recordingTags,
                eq(recordingTagAssignments.tagId, recordingTags.id),
            )
            .where(eq(recordingTagAssignments.recordingId, id));

        return NextResponse.json({ tags: updatedTags });
    } catch (error) {
        console.error("Error updating recording tags:", error);
        return NextResponse.json(
            { error: "Failed to update recording tags" },
            { status: 500 },
        );
    }
}
