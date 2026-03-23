import { OpenAI } from "openai";
import type {
    TranscriptionDiarized,
    TranscriptionVerbose,
} from "openai/resources/audio/transcriptions";
import { detectAudioFormat } from "@/lib/audio/detect-format";
import type {
    TranscriptionOptions,
    TranscriptionProvider,
    TranscriptionResult,
} from "./types";

export class LiteLLMTranscriptionProvider implements TranscriptionProvider {
    private readonly openai: OpenAI;

    constructor(apiKey: string, baseURL: string) {
        this.openai = new OpenAI({ apiKey, baseURL });
    }

    async transcribe(
        audioBuffer: Buffer,
        filename: string,
        options: TranscriptionOptions,
    ): Promise<TranscriptionResult> {
        const format = detectAudioFormat(audioBuffer);

        const baseName = filename.replace(/\.[^.]+$/, "");
        const audioFile = new File(
            [new Uint8Array(audioBuffer)],
            `${baseName}${format.extension}`,
            { type: format.contentType },
        );

        const { model, language } = options;

        const isDiarize =
            model.includes("diarize") || model.includes("diarized");
        const isGpt4o = model.startsWith("gpt-4o");

        const responseFormat = isDiarize
            ? ("diarized_json" as const)
            : isGpt4o
              ? ("json" as const)
              : ("verbose_json" as const);

        const transcription = await this.openai.audio.transcriptions.create({
            file: audioFile,
            model,
            response_format: responseFormat,
            ...(language ? { language } : {}),
        });

        return this.parseResponse(transcription, responseFormat, isDiarize);
    }

    private parseResponse(
        transcription: unknown,
        responseFormat: string,
        isDiarize: boolean,
    ): TranscriptionResult {
        if (isDiarize) {
            const diarized = transcription as TranscriptionDiarized;
            const text = (diarized.segments ?? [])
                .map((seg) => `${seg.speaker}: ${seg.text}`)
                .join("\n");
            return { text, detectedLanguage: null };
        }

        if (responseFormat === "verbose_json") {
            const verbose = transcription as TranscriptionVerbose;
            return {
                text: verbose.text,
                detectedLanguage: verbose.language ?? null,
            };
        }

        const text =
            typeof transcription === "string"
                ? transcription
                : ((transcription as { text?: string }).text ?? "");
        return { text, detectedLanguage: null };
    }
}
