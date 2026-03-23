import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { RecordingWorkstation } from "@/components/recordings/recording-workstation";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions } from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";

interface RecordingDetailPageProps {
    params: Promise<{ id: string }>;
}

export default async function RecordingDetailPage({
    params,
}: RecordingDetailPageProps) {
    // Check authentication server-side
    const session = await requireAuth();
    const { id } = await params;

    // Fetch recording from database
    const [recording] = await db
        .select()
        .from(recordings)
        .where(
            and(eq(recordings.id, id), eq(recordings.userId, session.user.id)),
        )
        .limit(1);

    if (!recording) {
        notFound();
    }

    const [transcription, enhancement] = await Promise.all([
        db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1)
            .then((rows) => rows[0]),
        db
            .select()
            .from(aiEnhancements)
            .where(eq(aiEnhancements.recordingId, id))
            .limit(1)
            .then((rows) => rows[0]),
    ]);

    return (
        <RecordingWorkstation
            recording={{
                ...recording,
                startTime: recording.startTime.toISOString(),
            }}
            transcription={
                transcription
                    ? {
                          text: transcription.text,
                          detectedLanguage:
                              transcription.detectedLanguage || undefined,
                          transcriptionType: transcription.transcriptionType,
                      }
                    : undefined
            }
            enhancement={
                enhancement
                    ? {
                          summary: enhancement.summary || undefined,
                          actionItems: (enhancement.actionItems as string[]) || [],
                          keyPoints: (enhancement.keyPoints as string[]) || [],
                      }
                    : undefined
            }
        />
    );
}
