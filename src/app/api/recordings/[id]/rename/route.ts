import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaudConnections, recordings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createPlaudClient } from "@/lib/plaud/client";

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
        const { filename } = body;

        if (!filename || typeof filename !== "string" || filename.trim().length === 0) {
            return NextResponse.json(
                { error: "Filename is required" },
                { status: 400 },
            );
        }

        const cleanFilename = filename.trim().substring(0, 255);

        const [recording] = await db
            .select()
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

        await db
            .update(recordings)
            .set({ filename: cleanFilename, updatedAt: new Date() })
            .where(eq(recordings.id, id));

        try {
            const [connection] = await db
                .select()
                .from(plaudConnections)
                .where(eq(plaudConnections.userId, session.user.id))
                .limit(1);

            if (connection) {
                const plaudClient = await createPlaudClient(
                    connection.bearerToken,
                    connection.apiBase,
                );
                await plaudClient.updateFilename(recording.plaudFileId, cleanFilename);
            }
        } catch (syncError) {
            console.error("Failed to sync filename to Plaud:", syncError);
        }

        return NextResponse.json({
            recording: { ...recording, filename: cleanFilename },
        });
    } catch (error) {
        console.error("Error renaming recording:", error);
        return NextResponse.json(
            { error: "Failed to rename recording" },
            { status: 500 },
        );
    }
}
