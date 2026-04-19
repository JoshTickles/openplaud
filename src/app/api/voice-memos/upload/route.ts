import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { detectAudioFormat } from "@/lib/audio/detect-format";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { createUserStorageProvider } from "@/lib/storage/factory";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

const ALLOWED_CONTENT_TYPES = new Set([
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/webm",
    "audio/flac",
    "audio/x-flac",
    "video/mp4", // some M4A files are served as video/mp4
]);

export async function POST(request: Request) {
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

        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json(
                { error: "No file provided" },
                { status: 400 },
            );
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
                { status: 400 },
            );
        }

        if (file.type && !ALLOWED_CONTENT_TYPES.has(file.type)) {
            return NextResponse.json(
                { error: `Unsupported file type: ${file.type}` },
                { status: 400 },
            );
        }

        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);

        const format = detectAudioFormat(audioBuffer);
        const baseName = file.name.replace(/\.[^.]+$/, "") || "Voice Memo";
        const storageKey = `${session.user.id}/uploads/${Date.now()}-${baseName}${format.extension}`;

        const storage = await createUserStorageProvider(session.user.id);
        await storage.uploadFile(storageKey, audioBuffer, format.contentType);

        const now = new Date();
        const [recording] = await db
            .insert(recordings)
            .values({
                userId: session.user.id,
                source: "upload",
                filename: baseName,
                duration: 0, // will be detected by the browser audio player
                startTime: now,
                endTime: now,
                filesize: audioBuffer.length,
                storageType: env.DEFAULT_STORAGE_TYPE,
                storagePath: storageKey,
                downloadedAt: now,
            })
            .returning({ id: recordings.id });

        return NextResponse.json({
            id: recording.id,
            filename: baseName,
        });
    } catch (error) {
        console.error("Error uploading voice memo:", error);
        return NextResponse.json(
            { error: "Failed to upload file" },
            { status: 500 },
        );
    }
}
