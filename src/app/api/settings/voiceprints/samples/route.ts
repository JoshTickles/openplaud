import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { speakerVoiceprints, voiceprintSamples } from "@/db/schema";
import { auth } from "@/lib/auth";
import { recomputeVoiceprint } from "@/lib/voiceprints/recompute";

export async function DELETE(request: Request) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");
        if (!id) {
            return NextResponse.json(
                { error: "id query parameter is required" },
                { status: 400 },
            );
        }

        // Resolve the sample and confirm the parent voiceprint belongs to the
        // user before deleting.
        const [sample] = await db
            .select({
                id: voiceprintSamples.id,
                voiceprintId: voiceprintSamples.voiceprintId,
                userId: speakerVoiceprints.userId,
            })
            .from(voiceprintSamples)
            .innerJoin(
                speakerVoiceprints,
                eq(speakerVoiceprints.id, voiceprintSamples.voiceprintId),
            )
            .where(eq(voiceprintSamples.id, id))
            .limit(1);

        if (!sample || sample.userId !== session.user.id) {
            return NextResponse.json(
                { error: "Sample not found" },
                { status: 404 },
            );
        }

        await db
            .delete(voiceprintSamples)
            .where(eq(voiceprintSamples.id, id));

        // Recompute the parent voiceprint (deletes it if this was its last sample).
        await recomputeVoiceprint(sample.voiceprintId);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting voiceprint sample:", error);
        return NextResponse.json(
            { error: "Failed to delete sample" },
            { status: 500 },
        );
    }
}
