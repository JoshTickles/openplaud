import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
    recordings,
    speakerVoiceprints,
    voiceprintSamples,
} from "@/db/schema";
import { auth } from "@/lib/auth";

export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const rows = await db
            .select({
                id: speakerVoiceprints.id,
                name: speakerVoiceprints.name,
                sampleCount: speakerVoiceprints.sampleCount,
                createdAt: speakerVoiceprints.createdAt,
                updatedAt: speakerVoiceprints.updatedAt,
            })
            .from(speakerVoiceprints)
            .where(eq(speakerVoiceprints.userId, session.user.id))
            .orderBy(speakerVoiceprints.name);

        // Attach each voiceprint's samples with the source recording name so
        // the UI can audition and prune them.
        const ids = rows.map((r) => r.id);
        const samples = ids.length
            ? await db
                  .select({
                      id: voiceprintSamples.id,
                      voiceprintId: voiceprintSamples.voiceprintId,
                      recordingId: voiceprintSamples.recordingId,
                      recordingName: recordings.filename,
                      segStart: voiceprintSamples.segStart,
                      segEnd: voiceprintSamples.segEnd,
                      createdAt: voiceprintSamples.createdAt,
                  })
                  .from(voiceprintSamples)
                  .leftJoin(
                      recordings,
                      eq(recordings.id, voiceprintSamples.recordingId),
                  )
                  .where(inArray(voiceprintSamples.voiceprintId, ids))
            : [];

        const byVoiceprint = new Map<string, typeof samples>();
        for (const s of samples) {
            const arr = byVoiceprint.get(s.voiceprintId) ?? [];
            arr.push(s);
            byVoiceprint.set(s.voiceprintId, arr);
        }

        const voiceprints = rows.map((r) => ({
            ...r,
            samples: byVoiceprint.get(r.id) ?? [],
        }));

        return NextResponse.json({ voiceprints });
    } catch (error) {
        console.error("Error fetching voiceprints:", error);
        return NextResponse.json(
            { error: "Failed to fetch voiceprints" },
            { status: 500 },
        );
    }
}

export async function PATCH(request: Request) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const body = await request.json();
        const id: unknown = body.id;
        const rawName: unknown = body.name;

        if (typeof id !== "string" || typeof rawName !== "string") {
            return NextResponse.json(
                { error: "id and name are required strings" },
                { status: 400 },
            );
        }
        const name = rawName.trim();
        if (name.length === 0 || name.length > 100) {
            return NextResponse.json(
                { error: "Name must be 1-100 characters" },
                { status: 400 },
            );
        }

        const [updated] = await db
            .update(speakerVoiceprints)
            .set({ name, updatedAt: new Date() })
            .where(
                and(
                    eq(speakerVoiceprints.id, id),
                    eq(speakerVoiceprints.userId, session.user.id),
                ),
            )
            .returning({ id: speakerVoiceprints.id });

        if (!updated) {
            return NextResponse.json(
                { error: "Voiceprint not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        // Unique (userId, name) collision: a voiceprint with that name exists.
        const message = String((error as Error)?.message || "");
        if (message.includes("unique") || message.includes("duplicate")) {
            return NextResponse.json(
                { error: "A voiceprint with that name already exists" },
                { status: 409 },
            );
        }
        console.error("Error renaming voiceprint:", error);
        return NextResponse.json(
            { error: "Failed to rename voiceprint" },
            { status: 500 },
        );
    }
}

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

        const [deleted] = await db
            .delete(speakerVoiceprints)
            .where(
                and(
                    eq(speakerVoiceprints.id, id),
                    eq(speakerVoiceprints.userId, session.user.id),
                ),
            )
            .returning({ id: speakerVoiceprints.id });

        if (!deleted) {
            return NextResponse.json(
                { error: "Voiceprint not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting voiceprint:", error);
        return NextResponse.json(
            { error: "Failed to delete voiceprint" },
            { status: 500 },
        );
    }
}
