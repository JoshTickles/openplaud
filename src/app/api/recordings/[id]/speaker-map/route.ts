import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
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

        const [transcription] = await db
            .select({ speakerMap: transcriptions.speakerMap })
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        return NextResponse.json({
            speakerMap: transcription?.speakerMap ?? null,
        });
    } catch (error) {
        console.error("Error fetching speaker map:", error);
        return NextResponse.json(
            { error: "Failed to fetch speaker map" },
            { status: 500 },
        );
    }
}

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
        const speakerMap: Record<string, string> = body.speakerMap;

        if (!speakerMap || typeof speakerMap !== "object") {
            return NextResponse.json(
                { error: "speakerMap must be an object" },
                { status: 400 },
            );
        }

        for (const [key, value] of Object.entries(speakerMap)) {
            if (typeof key !== "string" || typeof value !== "string") {
                return NextResponse.json(
                    { error: "All speaker map keys and values must be strings" },
                    { status: 400 },
                );
            }
            if (value.length > 100) {
                return NextResponse.json(
                    { error: "Speaker names must be 100 characters or fewer" },
                    { status: 400 },
                );
            }
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

        const [transcription] = await db
            .select({ id: transcriptions.id })
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (!transcription) {
            return NextResponse.json(
                { error: "No transcription found for this recording" },
                { status: 404 },
            );
        }

        await db
            .update(transcriptions)
            .set({ speakerMap })
            .where(eq(transcriptions.id, transcription.id));

        return NextResponse.json({ success: true, speakerMap });
    } catch (error) {
        console.error("Error updating speaker map:", error);
        return NextResponse.json(
            { error: "Failed to update speaker map" },
            { status: 500 },
        );
    }
}
