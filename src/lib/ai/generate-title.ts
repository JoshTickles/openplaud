import { and, eq } from "drizzle-orm";
import { OpenAI } from "openai";
import { db } from "@/db";
import { apiCredentials, userSettings } from "@/db/schema";
import { decrypt } from "@/lib/encryption";
import { inferProviderType } from "@/lib/transcription/providers/factory";
import {
    getDefaultPromptConfig,
    getPromptById,
    type PromptConfiguration,
} from "./prompt-presets";

const DEFAULT_CHAT_MODEL =
    process.env.ENHANCEMENT_CHAT_MODEL || "azure/openai-gpt-lb";

function isChatCapableProvider(cred: {
    provider: string;
    baseUrl: string | null;
}): boolean {
    const providerType = inferProviderType(cred.provider, cred.baseUrl);
    return providerType !== "google";
}

export async function generateTitleFromTranscription(
    userId: string,
    transcriptionText: string,
): Promise<string | null> {
    try {
        const [userSettingsRow] = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);

        let promptConfig: PromptConfiguration = getDefaultPromptConfig();
        if (userSettingsRow?.titleGenerationPrompt) {
            const config =
                userSettingsRow.titleGenerationPrompt as PromptConfiguration;
            promptConfig = {
                selectedPrompt: config.selectedPrompt || "default",
                customPrompts: config.customPrompts || [],
            };
        }

        let promptTemplate = getPromptById(
            promptConfig.selectedPrompt,
            promptConfig,
        );

        if (!promptTemplate) {
            console.warn(
                `Prompt not found: ${promptConfig.selectedPrompt}, using default`,
            );
            const defaultConfig = getDefaultPromptConfig();
            promptTemplate = getPromptById(
                defaultConfig.selectedPrompt,
                defaultConfig,
            );
            if (!promptTemplate) {
                return null;
            }
        }

        const allCredentials = await db
            .select()
            .from(apiCredentials)
            .where(eq(apiCredentials.userId, userId));

        const enhancementCred = allCredentials.find(
            (c) => c.isDefaultEnhancement && isChatCapableProvider(c),
        );
        const transcriptionCred = allCredentials.find(
            (c) => c.isDefaultTranscription && isChatCapableProvider(c),
        );
        const anyChatCred = allCredentials.find((c) =>
            isChatCapableProvider(c),
        );

        const credentials =
            enhancementCred || transcriptionCred || anyChatCred;

        if (!credentials) {
            console.warn("No chat-capable AI provider found for title generation");
            return null;
        }

        const apiKey = decrypt(credentials.apiKey);

        const openai = new OpenAI({
            apiKey,
            baseURL: credentials.baseUrl || undefined,
        });

        let model = credentials.defaultModel || DEFAULT_CHAT_MODEL;

        if (
            model.includes("whisper") ||
            model.includes("faster-whisper") ||
            model.includes("gemini")
        ) {
            model = DEFAULT_CHAT_MODEL;
        }

        // Truncate transcription if too long (to save tokens)
        const maxTranscriptionLength = 2000;
        const truncatedTranscription =
            transcriptionText.length > maxTranscriptionLength
                ? `${transcriptionText.substring(0, maxTranscriptionLength)}...`
                : transcriptionText;

        const prompt = promptTemplate.replace(
            "{transcription}",
            truncatedTranscription,
        );

        const response = await openai.chat.completions.create({
            model,
            messages: [
                {
                    role: "system",
                    content:
                        "You are a helpful assistant that generates concise, descriptive titles for audio recordings based on transcriptions. Always follow the rules strictly.",
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: 50, // Titles should be short
        });

        const title = response.choices[0]?.message?.content?.trim() || null;

        if (!title) {
            return null;
        }

        // Clean up the title (remove quotes, colons, etc. if AI didn't follow rules)
        let cleanedTitle = title
            .replace(/^["']|["']$/g, "") // Remove surrounding quotes
            .replace(/[:;]/g, "") // Remove colons and semicolons
            .trim();

        // Enforce 60 character limit
        if (cleanedTitle.length > 60) {
            cleanedTitle = `${cleanedTitle.substring(0, 57)}...`;
        }

        return cleanedTitle || null;
    } catch (error) {
        console.error("Error generating title:", error);
        return null;
    }
}
