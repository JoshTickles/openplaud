export interface TranscriptionResult {
    text: string;
    detectedLanguage: string | null;
}

export interface TranscriptionOptions {
    language?: string;
    model: string;
    responseFormat?: string;
}

export interface TranscriptionProvider {
    transcribe(
        audioBuffer: Buffer,
        filename: string,
        options: TranscriptionOptions,
    ): Promise<TranscriptionResult>;
}

export type ProviderType = "openai" | "azure" | "litellm" | "local";
