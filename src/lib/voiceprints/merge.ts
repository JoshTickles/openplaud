import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { speakerVoiceprints, voiceprintSamples } from "@/db/schema";
import { normalizeVoiceprintName } from "@/lib/voiceprints/names";
import { recomputeVoiceprint } from "@/lib/voiceprints/recompute";

/**
 * Find a user's voiceprint by name, ignoring case and surrounding whitespace,
 * so a spelling drift reuses the existing voice instead of starting a new one.
 *
 * Rows predating case-insensitive matching can still collide on the normalised
 * name, so the best-trained one wins rather than an arbitrary row.
 */
export async function findVoiceprintByName(
    userId: string,
    name: string,
): Promise<{ id: string; name: string } | undefined> {
    const [row] = await db
        .select({ id: speakerVoiceprints.id, name: speakerVoiceprints.name })
        .from(speakerVoiceprints)
        .where(
            and(
                eq(speakerVoiceprints.userId, userId),
                sql`lower(trim(${speakerVoiceprints.name})) = ${normalizeVoiceprintName(name)}`,
            ),
        )
        .orderBy(
            desc(speakerVoiceprints.sampleCount),
            speakerVoiceprints.createdAt,
        )
        .limit(1);
    return row;
}

/**
 * Fold one voiceprint into another: move its samples across, drop the source,
 * and recompute the target from the combined set.
 *
 * A sample is unique per (voiceprint, recording), so where both voices already
 * hold a sample from the same recording the source copy is discarded rather
 * than moved, which would violate that constraint.
 */
export async function mergeVoiceprintInto(
    sourceId: string,
    targetId: string,
): Promise<void> {
    if (sourceId === targetId) return;

    const targetRecordings = await db
        .select({ recordingId: voiceprintSamples.recordingId })
        .from(voiceprintSamples)
        .where(eq(voiceprintSamples.voiceprintId, targetId));
    const taken = targetRecordings.map((r) => r.recordingId);

    if (taken.length > 0) {
        await db
            .delete(voiceprintSamples)
            .where(
                and(
                    eq(voiceprintSamples.voiceprintId, sourceId),
                    inArray(voiceprintSamples.recordingId, taken),
                ),
            );
    }

    await db
        .update(voiceprintSamples)
        .set({ voiceprintId: targetId })
        .where(eq(voiceprintSamples.voiceprintId, sourceId));

    await db
        .delete(speakerVoiceprints)
        .where(eq(speakerVoiceprints.id, sourceId));

    await recomputeVoiceprint(targetId);
}
