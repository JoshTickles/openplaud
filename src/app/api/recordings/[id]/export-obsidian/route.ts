import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiEnhancements, recordings, transcriptions, userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { ObsidianClient, formatTranscriptMarkdown, generateVaultPath } from "@/lib/obsidian";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        const obsidianConfig = settings?.obsidianConfig as {
            enabled?: boolean;
            apiUrl?: string;
            apiKey?: string;
            vaultPath?: string;
        } | null;

        if (!obsidianConfig?.enabled || !obsidianConfig.apiUrl || !obsidianConfig.apiKey || !obsidianConfig.vaultPath) {
            return NextResponse.json(
                { error: "Obsidian integration not configured" },
                { status: 400 },
            );
        }

        const [recording] = await db
            .select()
            .from(recordings)
            .where(and(eq(recordings.id, id), eq(recordings.userId, session.user.id)))
            .limit(1);

        if (!recording) {
            return NextResponse.json({ error: "Recording not found" }, { status: 404 });
        }

        const [transcription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, id))
            .limit(1);

        if (!transcription?.text) {
            return NextResponse.json(
                { error: "No transcription available for this recording" },
                { status: 400 },
            );
        }

        const [enhancement] = await db
            .select()
            .from(aiEnhancements)
            .where(eq(aiEnhancements.recordingId, id))
            .limit(1);

        const apiKey = decrypt(obsidianConfig.apiKey);
        const client = new ObsidianClient({
            apiUrl: obsidianConfig.apiUrl,
            apiKey,
        });

        const markdown = formatTranscriptMarkdown(transcription.text, {
            title: recording.filename,
            date: recording.startTime,
            duration: recording.duration,
            language: transcription.detectedLanguage,
            recordingId: recording.id,
            provider: transcription.provider,
            model: transcription.model,
            summary: enhancement?.summary,
        });

        const vaultPath = generateVaultPath(
            obsidianConfig.vaultPath,
            recording.filename,
            recording.startTime,
        );

        const result = await client.writeNote(vaultPath, markdown);

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Failed to export to Obsidian" },
                { status: 502 },
            );
        }

        return NextResponse.json({
            success: true,
            vaultPath,
        });
    } catch (error) {
        console.error("Error exporting to Obsidian:", error);
        return NextResponse.json(
            { error: "Failed to export to Obsidian" },
            { status: 500 },
        );
    }
}
