import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
    recordings,
    speakerVoiceprints,
    transcriptions,
    voiceprintSamples,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { recomputeVoiceprint } from "@/lib/voiceprints/recompute";
import {
    centroidForTranscriptLabel,
    matchSpeakers,
    normalize,
    type Voiceprint,
} from "@/lib/transcription/voiceprint-match";

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
            .select({
                speakerMap: transcriptions.speakerMap,
                speakerCentroids: transcriptions.speakerCentroids,
            })
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        // Suggest names for unnamed speakers by matching this recording's
        // centroids against the user's saved voiceprint library.
        let suggestions: Record<string, { name: string; similarity: number }> =
            {};
        const centroids = transcription?.speakerCentroids;
        if (centroids && Object.keys(centroids).length > 0) {
            const library = await db
                .select({
                    name: speakerVoiceprints.name,
                    embedding: speakerVoiceprints.embedding,
                    sampleCount: speakerVoiceprints.sampleCount,
                })
                .from(speakerVoiceprints)
                .where(eq(speakerVoiceprints.userId, session.user.id));
            const matched = matchSpeakers(centroids, library as Voiceprint[]);
            for (const [label, m] of Object.entries(matched)) {
                if (m.name) {
                    suggestions[label] = {
                        name: m.name,
                        similarity: Number(m.similarity.toFixed(3)),
                    };
                }
            }
        }

        return NextResponse.json({
            speakerMap: transcription?.speakerMap ?? null,
            suggestions,
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
            .select({
                id: transcriptions.id,
                speakerCentroids: transcriptions.speakerCentroids,
                speakerSegments: transcriptions.speakerSegments,
            })
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

        // Enroll/refine voiceprints: every named speaker with a stored centroid
        // contributes a sample (one per recording); the voiceprint embedding is
        // recomputed as the mean of its samples.
        try {
            const centroids = transcription.speakerCentroids;
            if (centroids) {
                await enrollVoiceprints(
                    session.user.id,
                    id,
                    speakerMap,
                    centroids,
                    transcription.speakerSegments ?? undefined,
                );
            }
        } catch (e) {
            // Enrollment is best-effort; never fail the save over it.
            console.error("Voiceprint enrollment failed:", e);
        }

        return NextResponse.json({ success: true, speakerMap });
    } catch (error) {
        console.error("Error updating speaker map:", error);
        return NextResponse.json(
            { error: "Failed to update speaker map" },
            { status: 500 },
        );
    }
}

/**
 * Fold confirmed speaker names into the user's voiceprint library. The
 * speakerMap is keyed by the transcript's "Speaker N" labels, while centroids
 * are keyed by diarize "SPEAKER_NN" labels; centroidForTranscriptLabel bridges
 * the two namespaces.
 *
 * Each named speaker contributes one sample per recording (upserted, so
 * re-saving the same recording updates in place rather than double-counting).
 * The voiceprint embedding is then recomputed as the mean of all its samples,
 * so removing a bad sample later self-corrects the voiceprint.
 */
async function enrollVoiceprints(
    userId: string,
    recordingId: string,
    speakerMap: Record<string, string>,
    centroids: Record<string, number[]>,
    segments?: Record<string, { start: number; end: number }>,
): Promise<void> {
    // Resolve the diarize key behind each transcript label so we can attach
    // the representative segment (which is keyed by diarize label).
    const sortedKeys = Object.keys(centroids).sort();
    const diarizeKeyForLabel = (label: string): string | undefined => {
        const m = label.match(/^speaker\s*(\d+)$/i);
        if (m) {
            const idx = Number(m[1]) - 1;
            if (idx >= 0 && idx < sortedKeys.length) return sortedKeys[idx];
        }
        return centroids[label] ? label : undefined;
    };

    for (const [label, rawName] of Object.entries(speakerMap)) {
        const name = rawName.trim();
        const centroid = centroidForTranscriptLabel(label, centroids);
        if (!name || !centroid || centroid.length === 0) continue;
        // Skip pass-through labels like "Speaker 1" that aren't real names.
        if (/^speaker\s*\d+$/i.test(name)) continue;

        const diarizeKey = diarizeKeyForLabel(label);
        const seg = diarizeKey ? segments?.[diarizeKey] : undefined;

        // Find or create the voiceprint row for this name.
        const [existing] = await db
            .select({ id: speakerVoiceprints.id })
            .from(speakerVoiceprints)
            .where(
                and(
                    eq(speakerVoiceprints.userId, userId),
                    eq(speakerVoiceprints.name, name),
                ),
            )
            .limit(1);

        let voiceprintId: string;
        if (existing) {
            voiceprintId = existing.id;
        } else {
            const [created] = await db
                .insert(speakerVoiceprints)
                .values({
                    userId,
                    name,
                    embedding: normalize(centroid),
                    sampleCount: 1,
                })
                .returning({ id: speakerVoiceprints.id });
            voiceprintId = created.id;
        }

        // Upsert this recording's sample (one per voiceprint+recording).
        await db
            .insert(voiceprintSamples)
            .values({
                voiceprintId,
                recordingId,
                embedding: normalize(centroid),
                segStart: seg?.start ?? null,
                segEnd: seg?.end ?? null,
            })
            .onConflictDoUpdate({
                target: [
                    voiceprintSamples.voiceprintId,
                    voiceprintSamples.recordingId,
                ],
                set: {
                    embedding: normalize(centroid),
                    segStart: seg?.start ?? null,
                    segEnd: seg?.end ?? null,
                },
            });

        // Recompute the voiceprint as the mean of all its samples.
        await recomputeVoiceprint(voiceprintId);
    }
}
