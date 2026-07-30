import { eq } from "drizzle-orm";
import { db } from "@/db";
import { speakerVoiceprints, voiceprintSamples } from "@/db/schema";
import { averageEmbeddings } from "@/lib/transcription/voiceprint-match";

/**
 * Recompute a voiceprint's embedding + sampleCount as the mean of its samples.
 * If the last sample was removed, delete the now-empty voiceprint so the
 * library never shows a person with zero samples.
 */
export async function recomputeVoiceprint(voiceprintId: string): Promise<void> {
    const samples = await db
        .select({ embedding: voiceprintSamples.embedding })
        .from(voiceprintSamples)
        .where(eq(voiceprintSamples.voiceprintId, voiceprintId));

    if (samples.length === 0) {
        await db
            .delete(speakerVoiceprints)
            .where(eq(speakerVoiceprints.id, voiceprintId));
        return;
    }

    const mean = averageEmbeddings(samples.map((s) => s.embedding));
    await db
        .update(speakerVoiceprints)
        .set({
            embedding: mean,
            sampleCount: samples.length,
            updatedAt: new Date(),
        })
        .where(eq(speakerVoiceprints.id, voiceprintId));
}
