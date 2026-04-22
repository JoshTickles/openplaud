import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
    apiCredentials,
    plaudConnections,
    recordings,
    transcriptions,
    userSettings,
} from "@/db/schema";
import { generateTitleFromTranscription } from "@/lib/ai/generate-title";
import { decrypt } from "@/lib/encryption";
import { createPlaudClient } from "@/lib/plaud/client";
import { createUserStorageProvider } from "@/lib/storage/factory";
import {
    createTranscriptionProvider,
    inferProviderType,
} from "./providers";
import type { ProgressCallback } from "./providers/types";

function isGoogleInlineAudioLimitError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
        message.includes("inline audio exceeds duration limit") ||
        message.includes("request payload size exceeds the limit") ||
        message.includes("please use a gcs uri")
    );
}

function fallbackPriority(providerName: string, baseUrl?: string | null): number {
    const providerType = inferProviderType(providerName, baseUrl);
    switch (providerType) {
        case "litellm":
            return 0;
        case "azure":
            return 1;
        case "openai":
            return 2;
        case "local":
            return 3;
        default:
            return 9;
    }
}

export async function transcribeRecording(
    userId: string,
    recordingId: string,
    options?: { force?: boolean; onProgress?: ProgressCallback },
): Promise<{ success: boolean; error?: string; compressionWarning?: string }> {
    let audioTempPath: string | undefined;
    const onProgress = options?.onProgress;
    try {
        onProgress?.(2, "Loading recording");
        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, recordingId),
                    eq(recordings.userId, userId),
                ),
            )
            .limit(1);

        if (!recording) {
            return { success: false, error: "Recording not found" };
        }

        const [existingTranscription] = await db
            .select()
            .from(transcriptions)
            .where(eq(transcriptions.recordingId, recordingId))
            .limit(1);

        if (existingTranscription?.text && !options?.force) {
            onProgress?.(100, "Complete");
            return { success: true };
        }

        onProgress?.(5, "Loading settings");
        const [credentials] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.userId, userId),
                    eq(apiCredentials.isDefaultTranscription, true),
                ),
            )
            .limit(1);

        if (!credentials) {
            return { success: false, error: "No transcription API configured" };
        }

        const [settings] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        const defaultLanguage =
            settings?.defaultTranscriptionLanguage || undefined;
        const quality = settings?.transcriptionQuality || "balanced";
        const speakerDiarization = settings?.speakerDiarization ?? false;
        const diarizationSpeakers = settings?.diarizationSpeakers ?? 2;
        const autoGenerateTitle = settings?.autoGenerateTitle ?? true;
        const syncTitleToPlaud = settings?.syncTitleToPlaud ?? false;

        void quality;

        const apiKey = decrypt(credentials.apiKey);
        const model = credentials.defaultModel || "whisper-1";

        const providerType = inferProviderType(
            credentials.provider,
            credentials.baseUrl,
        );
        const provider = createTranscriptionProvider(
            providerType,
            apiKey,
            credentials.baseUrl || undefined,
        );

        onProgress?.(10, "Downloading audio");
        const storage = await createUserStorageProvider(userId);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        // Voice-fingerprint diarization pre-pass is disabled by default.
        // Gemini-only diarization produces better results for most meetings.
        // To re-enable, uncomment the block below or add a user setting.
        // if (speakerDiarization && providerType === "google") {
        //     const { writeFile } = await import("node:fs/promises");
        //     const { tmpdir } = await import("node:os");
        //     const { join } = await import("node:path");
        //     audioTempPath = join(tmpdir(), `openplaud-diarize-${recording.id}.audio`);
        //     await writeFile(audioTempPath, audioBuffer);
        // }

        const transcriptionOptions = {
            language: defaultLanguage,
            model,
            responseFormat: speakerDiarization
                ? "diarized_json"
                : "verbose_json",
            diarizationSpeakers,
            audioPath: audioTempPath,
            onProgress,
        } as const;

        let effectiveCredentials = credentials;
        let result;

        try {
            result = await provider.transcribe(
                audioBuffer,
                recording.filename,
                transcriptionOptions,
            );
        } catch (error) {
            if (
                providerType === "google" &&
                isGoogleInlineAudioLimitError(error)
            ) {
                const fallbackCredentials = await db
                    .select()
                    .from(apiCredentials)
                    .where(eq(apiCredentials.userId, userId));

                const fallback = fallbackCredentials
                    .filter((cred) => cred.id !== credentials.id)
                    .filter(
                        (cred) =>
                            inferProviderType(cred.provider, cred.baseUrl) !==
                            "google",
                    )
                    .sort(
                        (a, b) =>
                            fallbackPriority(a.provider, a.baseUrl) -
                            fallbackPriority(b.provider, b.baseUrl),
                    )[0];

                if (!fallback) {
                    throw error;
                }

                const fallbackProvider = createTranscriptionProvider(
                    inferProviderType(fallback.provider, fallback.baseUrl),
                    decrypt(fallback.apiKey),
                    fallback.baseUrl || undefined,
                );

                result = await fallbackProvider.transcribe(
                    audioBuffer,
                    recording.filename,
                    {
                        ...transcriptionOptions,
                        model: fallback.defaultModel || "whisper-1",
                    },
                );

                effectiveCredentials = fallback;
                console.warn(
                    "Google transcription hit inline-audio limits; used fallback provider:",
                    fallback.provider,
                );
            } else {
                throw error;
            }
        }

        const transcriptionText = result.text;
        const detectedLanguage = result.detectedLanguage;

        onProgress?.(88, "Saving transcription");
        if (existingTranscription) {
            await db
                .update(transcriptions)
                .set({
                    text: transcriptionText,
                    detectedLanguage,
                    transcriptionType: "server",
                    provider: effectiveCredentials.provider,
                    model: effectiveCredentials.defaultModel || "whisper-1",
                })
                .where(eq(transcriptions.id, existingTranscription.id));
        } else {
            await db.insert(transcriptions).values({
                recordingId,
                userId,
                text: transcriptionText,
                detectedLanguage,
                transcriptionType: "server",
                provider: effectiveCredentials.provider,
                model: effectiveCredentials.defaultModel || "whisper-1",
            });
        }

        if (autoGenerateTitle && transcriptionText.trim()) {
            onProgress?.(92, "Generating title");
            try {
                const generatedTitle = await generateTitleFromTranscription(
                    userId,
                    transcriptionText,
                );

                if (generatedTitle) {
                    await db
                        .update(recordings)
                        .set({
                            filename: generatedTitle,
                            updatedAt: new Date(),
                        })
                        .where(eq(recordings.id, recordingId));

                    if (syncTitleToPlaud && recording.source !== "upload" && recording.plaudFileId) {
                        try {
                            const [connection] = await db
                                .select()
                                .from(plaudConnections)
                                .where(eq(plaudConnections.userId, userId))
                                .limit(1);

                            if (connection) {
                                const plaudClient = await createPlaudClient(
                                    connection.bearerToken,
                                    connection.apiBase,
                                );
                                await plaudClient.updateFilename(
                                    recording.plaudFileId,
                                    generatedTitle,
                                );
                            }
                        } catch (error) {
                            console.error(
                                "Failed to sync title to Plaud:",
                                error,
                            );
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to generate title:", error);
            }
        }

        onProgress?.(100, "Complete");
        return { success: true, compressionWarning: result.compressionWarning };
    } catch (error) {
        console.error("Error transcribing recording:", error);
        return {
            success: false,
            error:
                error instanceof Error ? error.message : "Transcription failed",
        };
    } finally {
        // Clean up temp audio file used for diarization
        if (audioTempPath) {
            import("node:fs/promises")
                .then(({ unlink }) => unlink(audioTempPath!).catch(() => {}))
                .catch(() => {});
        }
    }
}
