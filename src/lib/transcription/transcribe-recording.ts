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

export async function transcribeRecording(
    userId: string,
    recordingId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
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

        if (existingTranscription?.text) {
            return { success: true };
        }

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

        const storage = await createUserStorageProvider(userId);
        const audioBuffer = await storage.downloadFile(recording.storagePath);

        const result = await provider.transcribe(
            audioBuffer,
            recording.filename,
            {
                language: defaultLanguage,
                model,
                responseFormat: speakerDiarization
                    ? "diarized_json"
                    : "verbose_json",
            },
        );

        const transcriptionText = result.text;
        const detectedLanguage = result.detectedLanguage;

        if (existingTranscription) {
            await db
                .update(transcriptions)
                .set({
                    text: transcriptionText,
                    detectedLanguage,
                    transcriptionType: "server",
                    provider: credentials.provider,
                    model: credentials.defaultModel || "whisper-1",
                })
                .where(eq(transcriptions.id, existingTranscription.id));
        } else {
            await db.insert(transcriptions).values({
                recordingId,
                userId,
                text: transcriptionText,
                detectedLanguage,
                transcriptionType: "server",
                provider: credentials.provider,
                model: credentials.defaultModel || "whisper-1",
            });
        }

        if (autoGenerateTitle && transcriptionText.trim()) {
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

                    if (syncTitleToPlaud) {
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

        return { success: true };
    } catch (error) {
        console.error("Error transcribing recording:", error);
        return {
            success: false,
            error:
                error instanceof Error ? error.message : "Transcription failed",
        };
    }
}
