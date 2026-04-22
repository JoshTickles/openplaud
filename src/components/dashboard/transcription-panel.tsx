"use client";

import { CloudDownload, FileText, Languages, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Recording } from "@/types/recording";
import { SpeakerLabelEditor } from "./speaker-label-editor";

interface Transcription {
    text?: string;
    language?: string;
    speakerMap?: Record<string, string> | null;
}

interface TranscriptionPanelProps {
    recording: Recording;
    transcription?: Transcription;
    isTranscribing: boolean;
    progress?: number;
    progressStage?: string;
    onTranscribe: () => void;
    onRetranscribe: () => void;
    onSpeakerMapChanged: (map: Record<string, string>) => void;
}

function applySpeakerMap(
    text: string,
    speakerMap: Record<string, string> | null | undefined,
): string {
    if (!speakerMap || Object.keys(speakerMap).length === 0) return text;

    let result = text;
    const sorted = Object.entries(speakerMap).sort(
        ([a], [b]) => b.length - a.length,
    );
    for (const [label, name] of sorted) {
        if (!name.trim()) continue;
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result.replace(new RegExp(escaped, "gi"), name);
    }
    return result;
}

export function TranscriptionPanel({
    recording,
    transcription,
    isTranscribing,
    progress = 0,
    progressStage = "",
    onTranscribe,
    onRetranscribe,
    onSpeakerMapChanged,
}: TranscriptionPanelProps) {
    const [isPullingPlaud, setIsPullingPlaud] = useState(false);

    const displayText = useMemo(
        () =>
            transcription?.text
                ? applySpeakerMap(transcription.text, transcription.speakerMap)
                : "",
        [transcription?.text, transcription?.speakerMap],
    );

    const isLongRecording = recording.duration > 60 * 60 * 1000;
    const hasPlaudFile = !!recording.plaudFileId;
    const showPlaudOption = isLongRecording && hasPlaudFile;

    const handlePullFromPlaud = async () => {
        setIsPullingPlaud(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/transcribe-plaud`,
                { method: "POST" },
            );
            if (!response.ok) {
                const data = await response.json();
                toast.error(data.error || "Failed to pull from Plaud");
                return;
            }
            toast.success("Transcript pulled from Plaud");
            window.location.reload();
        } catch {
            toast.error("Failed to pull transcript from Plaud");
        } finally {
            setIsPullingPlaud(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        Transcription
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        {transcription?.text && !isTranscribing && (
                            <Button
                                onClick={onRetranscribe}
                                size="sm"
                                variant="outline"
                            >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Re-transcribe
                            </Button>
                        )}
                        {!transcription?.text && !isTranscribing && (
                            <Button onClick={onTranscribe} size="sm">
                                <Sparkles className="w-4 h-4 mr-2" />
                                Transcribe
                            </Button>
                        )}
                        {isTranscribing && (
                            <Button size="sm" disabled>
                                <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                                Transcribing...
                            </Button>
                        )}
                    </div>
                </div>
                {showPlaudOption && !isTranscribing && !isPullingPlaud && (
                    <div className="mt-3 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-3">
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
                    <div className="mt-3 flex items-center gap-3 rounded-lg border px-4 py-3">
                        <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                        <p className="text-sm text-muted-foreground">Pulling transcript from Plaud...</p>
                    </div>
                )}
            </CardHeader>
            <CardContent>
                {isTranscribing ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4">
                        <div className="w-full max-w-sm space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">
                                    {progressStage || "Starting..."}
                                </span>
                                <span className="font-mono text-primary font-medium">
                                    {progress}%
                                </span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    </div>
                ) : transcription?.text ? (
                    <div className="space-y-4">
                        <SpeakerLabelEditor
                            recordingId={recording.id}
                            transcriptionText={transcription.text}
                            speakerMap={transcription.speakerMap ?? null}
                            onSpeakerMapChanged={onSpeakerMapChanged}
                        />
                        <div className="bg-muted rounded-lg p-4 max-h-96 overflow-y-auto">
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">
                                {displayText}
                            </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                            {transcription.language && (
                                <div className="flex items-center gap-1">
                                    <Languages className="w-3 h-3" />
                                    <span>
                                        Language: {transcription.language}
                                    </span>
                                </div>
                            )}
                            <div>
                                {transcription.text.split(/\s+/).length} words
                            </div>
                            <div>{transcription.text.length} characters</div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                        <p className="text-sm text-muted-foreground mb-4">
                            No transcription available
                        </p>
                        <Button onClick={onTranscribe} size="sm">
                            <Sparkles className="w-4 h-4 mr-2" />
                            Generate Transcription
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
