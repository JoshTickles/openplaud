import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

export async function POST(
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

        let force = false;
        try {
            const body = await request.json();
            force = body?.force === true;
        } catch {
            // No body or invalid JSON — default to non-force
        }

        const result = await transcribeRecording(session.user.id, id, { force });
        if (!result.success) {
            const errorMessage = result.error || "Transcription failed";
            const status =
                errorMessage === "Recording not found"
                    ? 404
                    : errorMessage === "No transcription API configured"
                      ? 400
                      : 500;
            return NextResponse.json({ error: errorMessage }, { status });
        }

        const [savedTranscription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (!savedTranscription) {
            return NextResponse.json(
                { error: "Transcription completed but no result was saved" },
                { status: 500 },
            );
        }

        return NextResponse.json({
            transcription: savedTranscription.text,
            detectedLanguage: savedTranscription.detectedLanguage ?? null,
        });
    } catch (error) {
        console.error("Error transcribing:", error);
        return NextResponse.json(
            { error: "Failed to transcribe recording" },
            { status: 500 },
        );
    }
}
