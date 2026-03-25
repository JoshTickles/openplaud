"use client";

import { FileText, Languages, RefreshCw, Sparkles } from "lucide-react";
import { useMemo } from "react";
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
    onTranscribe,
    onRetranscribe,
    onSpeakerMapChanged,
}: TranscriptionPanelProps) {
    const displayText = useMemo(
        () =>
            transcription?.text
                ? applySpeakerMap(transcription.text, transcription.speakerMap)
                : "",
        [transcription?.text, transcription?.speakerMap],
    );

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
            </CardHeader>
            <CardContent>
                {isTranscribing ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-4" />
                        <p className="text-sm text-muted-foreground">
                            Transcribing audio...
                        </p>
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
