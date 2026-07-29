export type ProgressCallback = (percent: number, stage: string) => void;

export interface TranscriptionResult {
    text: string;
    detectedLanguage: string | null;
    /** Set when audio was downsampled before upload due to file size. */
    compressionWarning?: string;
    /** Per-speaker diarization centroids (SPEAKER_NN -> embedding), when available. */
    speakerCentroids?: Record<string, number[]>;
}

export interface TranscriptionOptions {
    language?: string;
    model: string;
    responseFormat?: string;
    diarizationSpeakers?: number;
    /** Exact speaker count, set when the user has explicitly overridden detection for this run. */
    speakerCountOverride?: number;
    /** Absolute path to the audio file on disk (for diarization pre-pass) */
    audioPath?: string;
    onProgress?: ProgressCallback;
}

export interface TranscriptionProvider {
    transcribe(
        audioBuffer: Buffer,
        filename: string,
        options: TranscriptionOptions,
    ): Promise<TranscriptionResult>;
}

export type ProviderType = "openai" | "azure" | "litellm" | "local" | "google";
