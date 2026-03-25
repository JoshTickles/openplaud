import { and, eq } from "drizzle-orm";
import { OpenAI } from "openai";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiEnhancements, apiCredentials, recordings, transcriptions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { inferProviderType } from "@/lib/transcription/providers/factory";

const DEFAULT_CHAT_MODEL =
    process.env.ENHANCEMENT_CHAT_MODEL || "azure/openai-gpt-lb";

const ENHANCEMENT_SYSTEM_PROMPT = `You are an AI assistant that analyzes transcriptions and produces structured output. You MUST respond with valid JSON only, no markdown, no code blocks. The JSON must have this exact structure:
{
  "summary": "A concise 2-4 sentence summary of the recording",
  "actionItems": ["Action item 1", "Action item 2"],
  "keyPoints": ["Key point 1", "Key point 2"]
}

Rules:
- summary: 2-4 sentences capturing the main discussion/content
- actionItems: concrete, actionable tasks mentioned or implied. Empty array if none.
- keyPoints: the most important facts, decisions, or insights. 3-7 items.
- Be specific, not generic
- Do not invent information not present in the transcription`;

function isChatCapable(cred: {
    provider: string;
    baseUrl: string | null;
}): boolean {
    return inferProviderType(cred.provider, cred.baseUrl) !== "google";
}

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
                { error: "No transcription available" },
                { status: 400 },
            );
        }

        const allCredentials = await db
            .select()
            .from(apiCredentials)
            .where(eq(apiCredentials.userId, session.user.id));

        const enhancementCred = allCredentials.find(
            (c) => c.isDefaultEnhancement && isChatCapable(c),
        );
        const transcriptionCred = allCredentials.find(
            (c) => c.isDefaultTranscription && isChatCapable(c),
        );
        const anyChatCred = allCredentials.find((c) => isChatCapable(c));

        const credentials =
            enhancementCred || transcriptionCred || anyChatCred;

        if (!credentials) {
            return NextResponse.json(
                { error: "No chat-capable AI provider configured (Google Gemini cannot be used for enhancements — use LiteLLM or OpenAI-compatible)" },
                { status: 400 },
            );
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

        const maxLength = 4000;
        const truncatedText = transcription.text.length > maxLength
            ? `${transcription.text.substring(0, maxLength)}...`
            : transcription.text;

        const response = await openai.chat.completions.create({
            model,
            messages: [
                { role: "system", content: ENHANCEMENT_SYSTEM_PROMPT },
                { role: "user", content: `Analyze this transcription:\n\n${truncatedText}` },
            ],
            temperature: 0.3,
            max_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            return NextResponse.json({ error: "No response from AI" }, { status: 502 });
        }

        let parsed: { summary: string; actionItems: string[]; keyPoints: string[] };
        try {
            parsed = JSON.parse(content);
        } catch {
            return NextResponse.json(
                { error: "AI returned invalid JSON" },
                { status: 502 },
            );
        }

        const [existing] = await db
            .select()
            .from(aiEnhancements)
            .where(eq(aiEnhancements.recordingId, id))
            .limit(1);

        if (existing) {
            await db
                .update(aiEnhancements)
                .set({
                    summary: parsed.summary,
                    actionItems: parsed.actionItems,
                    keyPoints: parsed.keyPoints,
                    provider: credentials.provider,
                    model,
                })
                .where(eq(aiEnhancements.id, existing.id));
        } else {
            await db.insert(aiEnhancements).values({
                recordingId: id,
                userId: session.user.id,
                summary: parsed.summary,
                actionItems: parsed.actionItems,
                keyPoints: parsed.keyPoints,
                provider: credentials.provider,
                model,
            });
        }

        return NextResponse.json({
            enhancement: {
                summary: parsed.summary,
                actionItems: parsed.actionItems,
                keyPoints: parsed.keyPoints,
            },
        });
    } catch (error) {
        console.error("Error enhancing recording:", error);
        return NextResponse.json(
            { error: "Failed to enhance recording" },
            { status: 500 },
        );
    }
}
