"use client";

import {
    BookOpen,
    CheckCircle,
    Pencil,
    Sparkles,
    X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { TranscriptionSection } from "@/components/recordings/transcription-section";
import { MetalButton } from "@/components/metal-button";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Recording } from "@/types/recording";

interface Transcription {
    text?: string;
    detectedLanguage?: string;
    transcriptionType?: string;
}

interface Enhancement {
    summary?: string;
    actionItems?: string[];
    keyPoints?: string[];
}

interface RecordingWorkstationProps {
    recording: Recording;
    transcription?: Transcription;
    enhancement?: Enhancement;
}

export function RecordingWorkstation({
    recording,
    transcription,
    enhancement: initialEnhancement,
}: RecordingWorkstationProps) {
    const router = useRouter();
    const [filename, setFilename] = useState(recording.filename);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(recording.filename);
    const [isSavingRename, setIsSavingRename] = useState(false);
    const [enhancement, setEnhancement] = useState<Enhancement | undefined>(
        initialEnhancement,
    );
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [isExportingObsidian, setIsExportingObsidian] = useState(false);

    const handleRenameStart = () => {
        setRenameValue(filename);
        setIsRenaming(true);
    };

    const handleRenameCancel = () => {
        setIsRenaming(false);
        setRenameValue(filename);
    };

    const handleRenameSave = useCallback(async () => {
        const newName = renameValue.trim();
        if (!newName || newName === filename) {
            handleRenameCancel();
            return;
        }

        setIsSavingRename(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/rename`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: newName }),
                },
            );

            if (!response.ok) {
                const error = await response.json();
                toast.error(error.error || "Failed to rename recording");
                return;
            }

            setFilename(newName);
            setIsRenaming(false);
            toast.success("Recording renamed");
        } catch {
            toast.error("Failed to rename recording");
        } finally {
            setIsSavingRename(false);
        }
    }, [renameValue, filename, recording.id]);

    const handleEnhance = useCallback(async () => {
        setIsEnhancing(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/enhance`,
                { method: "POST" },
            );

            if (!response.ok) {
                const error = await response.json();
                toast.error(error.error || "Enhancement failed");
                return;
            }

            const data = await response.json();
            setEnhancement(data.enhancement);
            toast.success("AI enhancement complete");
        } catch {
            toast.error("Enhancement failed. Please try again.");
        } finally {
            setIsEnhancing(false);
        }
    }, [recording.id]);

    const handleExportObsidian = useCallback(async () => {
        setIsExportingObsidian(true);
        try {
            const response = await fetch(
                `/api/recordings/${recording.id}/export-obsidian`,
                { method: "POST" },
            );

            if (!response.ok) {
                const error = await response.json();
                toast.error(error.error || "Export to Obsidian failed");
                return;
            }

            const data = await response.json();
            toast.success(`Exported to Obsidian: ${data.vaultPath}`);
        } catch {
            toast.error("Export failed. Check your Obsidian settings.");
        } finally {
            setIsExportingObsidian(false);
        }
    }, [recording.id]);

    return (
        <div className="bg-background">
            <div className="container mx-auto px-4 py-6 max-w-4xl">
                {/* Header */}
                <div className="flex items-center gap-4 mb-6">
                    <Button
                        onClick={() => router.push("/dashboard")}
                        variant="outline"
                        size="icon"
                        aria-label="Back to dashboard"
                    >
                        ←
                    </Button>

                    <div className="flex-1 min-w-0">
                        {isRenaming ? (
                            <div className="flex items-center gap-2">
                                <Input
                                    value={renameValue}
                                    onChange={(e) =>
                                        setRenameValue(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") handleRenameSave();
                                        if (e.key === "Escape") handleRenameCancel();
                                    }}
                                    className="text-xl font-bold h-auto py-1"
                                    autoFocus
                                    disabled={isSavingRename}
                                />
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={handleRenameSave}
                                    disabled={isSavingRename}
                                    aria-label="Save rename"
                                >
                                    <CheckCircle className="w-5 h-5 text-green-500" />
                                </Button>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={handleRenameCancel}
                                    disabled={isSavingRename}
                                    aria-label="Cancel rename"
                                >
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <h1 className="text-3xl font-bold truncate">
                                    {filename}
                                </h1>
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={handleRenameStart}
                                    aria-label="Rename recording"
                                    title="Rename and sync to Plaud"
                                    className="shrink-0"
                                >
                                    <Pencil className="w-4 h-4" />
                                </Button>
                            </div>
                        )}
                        <p className="text-muted-foreground text-sm mt-1">
                            {new Date(recording.startTime).toLocaleString()}
                        </p>
                    </div>
                </div>

                {/* Content */}
                <div className="space-y-6">
                    <RecordingPlayer recording={recording} />

                    <TranscriptionSection
                        recordingId={recording.id}
                        initialTranscription={transcription?.text}
                        initialLanguage={transcription?.detectedLanguage}
                        initialType={transcription?.transcriptionType}
                    />

                    {/* AI Enhancement Panel */}
                    <Panel>
                        <div className="space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Sparkles className="w-5 h-5 text-accent-cyan" />
                                    AI Enhancement
                                </h2>
                                <div className="flex gap-2">
                                    <MetalButton
                                        onClick={handleEnhance}
                                        variant="cyan"
                                        disabled={
                                            isEnhancing ||
                                            !transcription?.text
                                        }
                                        className="w-full md:w-auto"
                                    >
                                        {isEnhancing
                                            ? "Analysing..."
                                            : enhancement
                                              ? "Re-enhance"
                                              : "Enhance"}
                                    </MetalButton>
                                    <MetalButton
                                        onClick={handleExportObsidian}
                                        variant="default"
                                        disabled={
                                            isExportingObsidian ||
                                            !transcription?.text
                                        }
                                        className="w-full md:w-auto"
                                        title="Export to Obsidian"
                                    >
                                        {isExportingObsidian ? (
                                            "Exporting..."
                                        ) : (
                                            <>
                                                <BookOpen className="w-4 h-4" />
                                                Obsidian
                                            </>
                                        )}
                                    </MetalButton>
                                </div>
                            </div>

                            {enhancement ? (
                                <div className="space-y-4">
                                    {enhancement.summary && (
                                        <div className="info-card">
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                                                Summary
                                            </p>
                                            <p className="leading-relaxed">
                                                {enhancement.summary}
                                            </p>
                                        </div>
                                    )}

                                    {enhancement.keyPoints &&
                                        enhancement.keyPoints.length > 0 && (
                                            <div className="info-card">
                                                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                                                    Key Points
                                                </p>
                                                <ul className="space-y-1">
                                                    {enhancement.keyPoints.map(
                                                        (point, i) => (
                                                            <li
                                                                key={i}
                                                                className="flex items-start gap-2 text-sm"
                                                            >
                                                                <span className="text-accent-cyan mt-0.5">
                                                                    •
                                                                </span>
                                                                {point}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            </div>
                                        )}

                                    {enhancement.actionItems &&
                                        enhancement.actionItems.length > 0 && (
                                            <div className="info-card">
                                                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                                                    Action Items
                                                </p>
                                                <ul className="space-y-1">
                                                    {enhancement.actionItems.map(
                                                        (item, i) => (
                                                            <li
                                                                key={i}
                                                                className="flex items-start gap-2 text-sm"
                                                            >
                                                                <span className="text-accent-pink mt-0.5">
                                                                    ✓
                                                                </span>
                                                                {item}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            </div>
                                        )}
                                </div>
                            ) : (
                                <Panel variant="inset" className="text-center py-8">
                                    <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
                                    <p className="text-muted-foreground mb-1">
                                        No AI enhancement yet
                                    </p>
                                    <p className="text-sm text-text-muted">
                                        {transcription?.text
                                            ? 'Click "Enhance" to generate a summary, key points, and action items'
                                            : "Transcribe first, then enhance with AI"}
                                    </p>
                                </Panel>
                            )}
                        </div>
                    </Panel>

                    {/* Metadata */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Duration
                                    </div>
                                    <div className="font-medium">
                                        {Math.floor(recording.duration / 60000)}
                                        :
                                        {((recording.duration % 60000) / 1000)
                                            .toFixed(0)
                                            .padStart(2, "0")}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        File Size
                                    </div>
                                    <div className="font-medium">
                                        {(
                                            recording.filesize /
                                            (1024 * 1024)
                                        ).toFixed(2)}{" "}
                                        MB
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Device
                                    </div>
                                    <div className="font-mono text-xs truncate">
                                        {recording.deviceSn}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs mb-1">
                                        Date
                                    </div>
                                    <div className="font-medium">
                                        {new Date(
                                            recording.startTime,
                                        ).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
