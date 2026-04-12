export interface TranscriptionResult {
    text: string;
    detectedLanguage: string | null;
    /** Set when audio was downsampled before upload due to file size. */
    compressionWarning?: string;
}

export interface TranscriptionOptions {
    language?: string;
    model: string;
    responseFormat?: string;
    diarizationSpeakers?: number;
    /** Absolute path to the audio file on disk (for diarization pre-pass) */
    audioPath?: string;
}

export interface TranscriptionProvider {
    transcribe(
        audioBuffer: Buffer,
        filename: string,
        options: TranscriptionOptions,
    ): Promise<TranscriptionResult>;
}

export type ProviderType = "openai" | "azure" | "litellm" | "local" | "google";
