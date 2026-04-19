import { and, desc, eq } from "drizzle-orm";
import { VoiceMemoWorkstation } from "@/components/voice-memos/workstation";
import { db } from "@/db";
import {
    recordings,
    recordingTagAssignments,
    recordingTags,
    transcriptions,
} from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";
import type { Tag } from "@/types/recording";
import { serializeRecording } from "@/types/recording";

export default async function VoiceMemosPage() {
    const session = await requireAuth();

    const userRecordings = await db
        .select({
            id: recordings.id,
            filename: recordings.filename,
            duration: recordings.duration,
            startTime: recordings.startTime,
            filesize: recordings.filesize,
            deviceSn: recordings.deviceSn,
            upstreamDeleted: recordings.upstreamDeleted,
            plaudFileId: recordings.plaudFileId,
            source: recordings.source,
        })
        .from(recordings)
        .where(
            and(
                eq(recordings.userId, session.user.id),
                eq(recordings.isTrash, false),
                eq(recordings.source, "upload"),
            ),
        )
        .orderBy(desc(recordings.startTime));

    const recordingIds = userRecordings.map((r) => r.id);

    const userTranscriptions =
        recordingIds.length > 0
            ? await db
                  .select({
                      recordingId: transcriptions.recordingId,
                      text: transcriptions.text,
                      language: transcriptions.detectedLanguage,
                      speakerMap: transcriptions.speakerMap,
                  })
                  .from(transcriptions)
                  .where(eq(transcriptions.userId, session.user.id))
            : [];

    const allTags = await db
        .select()
        .from(recordingTags)
        .where(eq(recordingTags.userId, session.user.id))
        .orderBy(recordingTags.name);

    const allAssignments =
        recordingIds.length > 0
            ? await db
                  .select({
                      recordingId: recordingTagAssignments.recordingId,
                      tagId: recordingTagAssignments.tagId,
                  })
                  .from(recordingTagAssignments)
                  .innerJoin(
                      recordingTags,
                      eq(recordingTagAssignments.tagId, recordingTags.id),
                  )
                  .where(eq(recordingTags.userId, session.user.id))
            : [];

    const tagMap = new Map(allTags.map((t) => [t.id, t]));
    const recordingTagMap = new Map<string, Tag[]>();
    for (const a of allAssignments) {
        const tag = tagMap.get(a.tagId);
        if (!tag) continue;
        const list = recordingTagMap.get(a.recordingId) ?? [];
        list.push({ id: tag.id, name: tag.name, color: tag.color });
        recordingTagMap.set(a.recordingId, list);
    }

    const recordingsData = userRecordings.map((r) => {
        const serialized = serializeRecording(r);
        serialized.tags = recordingTagMap.get(r.id) ?? [];
        return serialized;
    });

    const transcriptionMap = new Map(
        userTranscriptions
            .filter((t) => recordingIds.includes(t.recordingId))
            .map((t) => [
                t.recordingId,
                {
                    text: t.text,
                    language: t.language || undefined,
                    speakerMap: t.speakerMap ?? undefined,
                },
            ]),
    );

    const serializedTags: Tag[] = allTags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
    }));

    return (
        <VoiceMemoWorkstation
            recordings={recordingsData}
            transcriptions={transcriptionMap}
            allTags={serializedTags}
        />
    );
}
