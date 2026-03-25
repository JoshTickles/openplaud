import { VertexAI } from "@google-cloud/vertexai";
import { detectAudioFormat } from "@/lib/audio/detect-format";
import type {
    TranscriptionOptions,
    TranscriptionProvider,
    TranscriptionResult,
} from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_SPEAKER_COUNT = 2;

function mimeTypeForGemini(contentType: string): string {
    const map: Record<string, string> = {
        "audio/ogg": "audio/ogg",
        "audio/mpeg": "audio/mp3",
        "audio/wav": "audio/wav",
        "audio/flac": "audio/flac",
    };
    return map[contentType] ?? "audio/mp3";
}

function buildPrompt(useDiarization: boolean, _speakerCount: number, language?: string): string {
    const langHint = language ? ` The audio is in ${language}.` : "";

    if (useDiarization) {
        return [
            "Transcribe this audio recording accurately and completely.",
            "Identify and label every distinct speaker consistently as Speaker 1, Speaker 2, Speaker 3, etc. Detect ALL speakers present — do NOT merge or combine different speakers.",
            "",
            "CRITICAL FORMATTING RULES (you MUST follow these):",
            "- Each speaker turn MUST start on its own line as: Speaker N: <text>",
            "- There MUST be exactly one blank line between every speaker turn.",
            "- NEVER merge multiple speaker turns into a single paragraph.",
            "- Preserve this formatting even for very long recordings.",
            "",
            "Do NOT include timestamps, commentary, or analysis — only the verbatim transcription with speaker labels.",
            `Maintain the original language of the recording.${langHint}`,
        ].join("\n");
    }

    return [
        "Transcribe this audio recording accurately and completely.",
        "Output only the verbatim transcription text. Do NOT include timestamps, speaker labels, commentary, or analysis.",
        `Maintain the original language of the recording.${langHint}`,
    ].join("\n");
}

/**
 * Ensure exactly one blank line between each "Speaker N:" turn,
 * regardless of how Gemini formatted the raw output.
 */
function ensureSpeakerBlankLines(text: string): string {
    const lines = text.split("\n");
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isNewSpeakerTurn = /^Speaker\s+\d+:/i.test(line.trimStart());

        if (isNewSpeakerTurn && result.length > 0) {
            // Remove any trailing blank lines before adding exactly one
            while (result.length > 0 && result[result.length - 1].trim() === "") {
                result.pop();
            }
            result.push("");
        }

        result.push(line);
    }

    return result.join("\n").trim();
}

export class GoogleSpeechTranscriptionProvider implements TranscriptionProvider {
    private readonly projectId: string;
    private readonly location: string;

    constructor(_apiKey: string, _baseURL?: string) {
        this.projectId = process.env.GOOGLE_PROJECT_ID || "";
        if (!this.projectId) {
            throw new Error("GOOGLE_PROJECT_ID environment variable is required for Gemini provider");
        }
        this.location = process.env.GOOGLE_LOCATION || "us-central1";
    }

    async transcribe(
        audioBuffer: Buffer,
        _filename: string,
        options: TranscriptionOptions,
    ): Promise<TranscriptionResult> {
        const format = detectAudioFormat(audioBuffer);
        const useDiarization = options.responseFormat === "diarized_json";
        const speakerCount = Math.max(
            1,
            options.diarizationSpeakers ?? DEFAULT_SPEAKER_COUNT,
        );

        const vertexAI = new VertexAI({
            project: this.projectId,
            location: this.location,
        });

        const modelId = this.resolveModel(options.model);

        const model = vertexAI.getGenerativeModel({
            model: modelId,
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 65536,
            },
        });

        const prompt = buildPrompt(useDiarization, speakerCount, options.language);

        const response = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeTypeForGemini(format.contentType),
                                data: audioBuffer.toString("base64"),
                            },
                        },
                        { text: prompt },
                    ],
                },
            ],
        });

        const raw =
            response.response.candidates?.[0]?.content?.parts
                ?.map((part) => part.text ?? "")
                .join("")
                .trim() ?? "";

        const text = useDiarization ? ensureSpeakerBlankLines(raw) : raw;

        return { text, detectedLanguage: null };
    }

    private resolveModel(model: string): string {
        if (
            model &&
            model !== "latest_long" &&
            !model.includes("whisper") &&
            !model.includes("chirp")
        ) {
            return model;
        }
        return DEFAULT_MODEL;
    }
}
