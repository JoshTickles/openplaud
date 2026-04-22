"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CloudDownload } from "lucide-react";
import { LEDIndicator } from "@/components/led-indicator";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";

interface TranscriptionSectionProps {
    recordingId: string;
    initialTranscription?: string;
    initialLanguage?: string | null;
    initialType?: string | null;
    duration?: number;
    plaudFileId?: string | null;
}

export function TranscriptionSection({
    recordingId,
    initialTranscription,
    initialLanguage,
    initialType,
    duration,
    plaudFileId,
}: TranscriptionSectionProps) {
    const [transcription, setTranscription] = useState(initialTranscription);
    const [detectedLanguage, setDetectedLanguage] = useState(initialLanguage);
    const [transcriptionType, setTranscriptionType] = useState(initialType);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPullingPlaud, setIsPullingPlaud] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressStage, setProgressStage] = useState("");

    const isLongRecording = (duration ?? 0) > 60 * 60 * 1000;
    const showPlaudOption = isLongRecording && !!plaudFileId;

    const handlePullFromPlaud = async () => {
        setIsPullingPlaud(true);
        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/transcribe-plaud`,
                { method: "POST" },
            );
            const data = await response.json();
            if (!response.ok) {
                toast.error(data.error || "Failed to pull from Plaud");
                return;
            }
            setTranscription(data.transcription);
            setDetectedLanguage(data.detectedLanguage);
            setTranscriptionType("server");
            toast.success("Transcript pulled from Plaud");
        } catch {
            toast.error("Failed to pull transcript from Plaud");
        } finally {
            setIsPullingPlaud(false);
        }
    };

    const handleTranscribe = async () => {
        const isRetranscribe = !!transcription;
        setIsProcessing(true);
        setProgress(0);
        setProgressStage("Starting");

        try {
            const response = await fetch(
                `/api/recordings/${recordingId}/transcribe?stream=1`,
                {
                    method: "POST",
                    headers: isRetranscribe ? { "Content-Type": "application/json" } : undefined,
                    body: isRetranscribe ? JSON.stringify({ force: true }) : undefined,
                },
            );

            if (!response.ok || !response.body) {
                let errorMessage = "Transcription failed";
                try {
                    const errorData = await response.json();
                    if (
                        response.status === 400 &&
                        errorData.error?.includes("No transcription API")
                    ) {
                        errorMessage =
                            "Please configure an AI provider in Settings first";
                    } else {
                        errorMessage = errorData.error || errorMessage;
                    }
                } catch {
                    // non-JSON response
                }
                toast.error(errorMessage);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const dataLine = line.trim();
                    if (!dataLine.startsWith("data: ")) continue;
                    try {
                        const event = JSON.parse(dataLine.slice(6));

                        if (event.error) {
                            toast.error(event.error);
                            return;
                        }

                        if (event.progress !== undefined) {
                            setProgress(event.progress);
                            setProgressStage(event.stage || "");
                        }

                        if (event.result) {
                            setTranscription(event.result.transcription);
                            setDetectedLanguage(event.result.detectedLanguage);
                            setTranscriptionType("server");
                            toast.success("Transcription complete");
                            if (event.result.compressionWarning) {
                                toast.warning(event.result.compressionWarning, {
                                    duration: 10000,
                                });
                            }
                        }
                    } catch {
                        // skip malformed events
                    }
                }
            }
        } catch {
            toast.error("Transcription failed. Please try again.");
        } finally {
            setIsProcessing(false);
            setProgress(0);
            setProgressStage("");
        }
    };

    return (
        <Panel>
            <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-xl font-bold">Transcription</h2>
                        {detectedLanguage && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel-inset">
                                <LEDIndicator
                                    active
                                    status="active"
                                    size="sm"
                                />
                                <span className="text-label text-xs">
                                    Lang:{" "}
                                    <span className="font-mono uppercase text-accent-cyan">
                                        {detectedLanguage}
                                    </span>
                                </span>
                            </div>
                        )}
                        {transcriptionType && (
                            <span className="text-label text-xs px-3 py-1.5 rounded-lg bg-panel-inset border border-panel-border">
                                {transcriptionType}
                            </span>
                        )}
                    </div>
                    <MetalButton
                        onClick={handleTranscribe}
                        variant="cyan"
                        disabled={isProcessing}
                        className="w-full md:w-auto"
                    >
                        {isProcessing
                            ? "Processing..."
                            : transcription
                              ? "Re-transcribe"
                              : "Transcribe"}
                    </MetalButton>
                </div>

                {isProcessing && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                                {progressStage}
                            </span>
                            <span className="font-mono text-accent-cyan">
                                {progress}%
                            </span>
                        </div>
                        <div className="h-2 rounded-full bg-panel-inset overflow-hidden">
                            <div
                                className="h-full rounded-full bg-accent-cyan transition-all duration-300 ease-out"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}

                {showPlaudOption && !isProcessing && !isPullingPlaud && (
                    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-3">
                        <CloudDownload className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                        <p className="text-sm text-blue-800 dark:text-blue-300 flex-1">
                            This recording seems long — pull transcript from Plaud?
                        </p>
                        <Button
                            onClick={handlePullFromPlaud}
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                        >
                            Pull from Plaud
                        </Button>
                    </div>
                )}
                {isPullingPlaud && (
                    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
                        <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                        <p className="text-sm text-muted-foreground">Pulling transcript from Plaud...</p>
                    </div>
                )}

                {transcription ? (
                    <div className="info-card">
                        <p className="whitespace-pre-wrap leading-relaxed">
                            {transcription}
                        </p>
                    </div>
                ) : (
                    !isProcessing && (
                        <Panel variant="inset" className="text-center py-12">
                            <LEDIndicator
                                active={false}
                                status="active"
                                size="md"
                                className="mx-auto mb-4"
                            />
                            <p className="text-muted-foreground mb-2">
                                No transcription yet
                            </p>
                            <p className="text-sm text-text-muted">
                                Click "Transcribe" to generate a transcription
                            </p>
                        </Panel>
                    )
                )}
            </div>
        </Panel>
    );
}
