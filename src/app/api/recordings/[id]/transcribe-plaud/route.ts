import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { auth } from "@/lib/auth";
import { createPlaudClient } from "@/lib/plaud/client";

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

        if (!recording.plaudFileId) {
            return NextResponse.json(
                { error: "Recording has no linked Plaud file" },
                { status: 400 },
            );
        }

        const [connection] = await db
            .select()
            .from(plaudConnections)
            .where(eq(plaudConnections.userId, session.user.id))
            .limit(1);

        if (!connection) {
            return NextResponse.json(
                { error: "No Plaud connection configured" },
                { status: 400 },
            );
        }

        const plaudClient = await createPlaudClient(
            connection.bearerToken,
            connection.apiBase,
        );

        const plaudText = await plaudClient.fetchTranscript(recording.plaudFileId);

        if (!plaudText || plaudText.trim().length === 0) {
            return NextResponse.json(
                { error: "No transcript available on Plaud for this recording. Transcribe it in the Plaud app first." },
                { status: 404 },
            );
        }

        console.log(
            `[Plaud] Pulled transcript for recording ${id} ` +
            `(${Math.round(recording.duration / 60_000)} min, ${plaudText.length} chars)`,
        );

        // Save the transcript
        const [existing] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (existing) {
            await db
                .update(transcriptions)
                .set({
                    text: plaudText,
                    detectedLanguage: null,
                    transcriptionType: "server",
                    provider: "plaud",
                    model: "plaud-cloud",
                })
                .where(eq(transcriptions.id, existing.id));
        } else {
            await db.insert(transcriptions).values({
                recordingId: id,
                userId: session.user.id,
                text: plaudText,
                detectedLanguage: null,
                transcriptionType: "server",
                provider: "plaud",
                model: "plaud-cloud",
            });
        }

        // Auto-generate title if enabled
        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        if (settings?.autoGenerateTitle && plaudText.trim()) {
            try {
                const title = await generateTitleFromTranscription(
                    session.user.id,
                    plaudText,
                );
                if (title) {
                    await db
                        .update(recordings)
                        .set({ filename: title, updatedAt: new Date() })
                        .where(eq(recordings.id, id));

                    if (settings.syncTitleToPlaud) {
                        await plaudClient
                            .updateFilename(recording.plaudFileId, title)
                            .catch((err: unknown) =>
                                console.error("Failed to sync title to Plaud:", err),
                            );
                    }
                }
            } catch (err) {
                console.error("Failed to generate title:", err);
            }
        }

        return NextResponse.json({
            transcription: plaudText,
            detectedLanguage: null,
        });
    } catch (error) {
        console.error("Error pulling Plaud transcript:", error);
        return NextResponse.json(
            { error: "Failed to pull transcript from Plaud" },
            { status: 500 },
        );
    }
}
