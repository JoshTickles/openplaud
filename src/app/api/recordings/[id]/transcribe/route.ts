import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { transcribeRecording } from "@/lib/transcription/transcribe-recording";

export const dynamic = "force-dynamic";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
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
            return new Response(
                JSON.stringify({ error: "Recording not found" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }

        let force = false;
        try {
            const body = await request.json();
            force = body?.force === true;
        } catch {
            // No body or invalid JSON — default to non-force
        }

        const url = new URL(request.url);
        const wantStream = url.searchParams.get("stream") === "1";
        console.log(`[Transcribe] stream=${wantStream}, force=${force}, url=${request.url}`);

        if (!wantStream) {
            return handleJsonResponse(session.user.id, id, force);
        }

        return handleStreamResponse(session.user.id, id, force);
    } catch (error) {
        console.error("Error transcribing:", error);
        return new Response(
            JSON.stringify({ error: "Failed to transcribe recording" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }
}

async function handleJsonResponse(userId: string, recordingId: string, force: boolean) {
    try {
        const result = await transcribeRecording(userId, recordingId, { force });
        if (!result.success) {
            const errorMessage = result.error || "Transcription failed";
            const status =
                errorMessage === "Recording not found"
                    ? 404
                    : errorMessage === "No transcription API configured"
                      ? 400
                      : 500;
            return new Response(JSON.stringify({ error: errorMessage }), {
                status,
                headers: { "Content-Type": "application/json" },
            });
        }

        const [savedTranscription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, recordingId))
            .limit(1);

        if (!savedTranscription) {
            return new Response(
                JSON.stringify({ error: "Transcription completed but no result was saved" }),
                { status: 500, headers: { "Content-Type": "application/json" } },
            );
        }

        return new Response(
            JSON.stringify({
                transcription: savedTranscription.text,
                detectedLanguage: savedTranscription.detectedLanguage ?? null,
                compressionWarning: result.compressionWarning ?? null,
            }),
            { headers: { "Content-Type": "application/json" } },
        );
    } catch (error) {
        console.error("Error transcribing:", error);
        return new Response(
            JSON.stringify({ error: "Failed to transcribe recording" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }
}

function handleStreamResponse(userId: string, recordingId: string, force: boolean) {
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const send = (data: Record<string, unknown>) => {
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
                );
            };

            const onProgress = (percent: number, stage: string) => {
                send({ progress: percent, stage });
            };

            try {
                const result = await transcribeRecording(userId, recordingId, {
                    force,
                    onProgress,
                });

                if (!result.success) {
                    send({ error: result.error || "Transcription failed" });
                    controller.close();
                    return;
                }

                const [savedTranscription] = await db
                    .select()
                    .from(transcriptions)
                    .where(eq(transcriptions.recordingId, recordingId))
                    .limit(1);

                if (!savedTranscription) {
                    send({
                        error: "Transcription completed but no result was saved",
                    });
                    controller.close();
                    return;
                }

                send({
                    progress: 100,
                    stage: "Complete",
                    result: {
                        transcription: savedTranscription.text,
                        detectedLanguage:
                            savedTranscription.detectedLanguage ?? null,
                        compressionWarning:
                            result.compressionWarning ?? null,
                    },
                });
            } catch (error) {
                console.error("Error transcribing:", error);
                send({ error: "Failed to transcribe recording" });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
