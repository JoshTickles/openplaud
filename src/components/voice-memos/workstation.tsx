"use client";

import { BookOpen, CheckCircle, Mic, Pencil, Settings, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RecordingList } from "@/components/dashboard/recording-list";
import { RecordingPlayer } from "@/components/dashboard/recording-player";
import { SpeakerLabelEditor } from "@/components/dashboard/speaker-label-editor";
import { TagAssignment } from "@/components/dashboard/tag-assignment";
import { TranscriptionPanel } from "@/components/dashboard/transcription-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Recording, Tag } from "@/types/recording";
import { UploadZone } from "./upload-zone";

interface TranscriptionData {
    text?: string;
    language?: string;
    speakerMap?: Record<string, string>;
}

interface VoiceMemoWorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    allTags: Tag[];
}

export function VoiceMemoWorkstation({
    recordings,
    transcriptions,
    allTags,
}: VoiceMemoWorkstationProps) {
    const router = useRouter();
    const [currentRecording, setCurrentRecording] = useState<Recording | null>(
        recordings.length > 0 ? recordings[0] : null,
    );
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [isSavingRename, setIsSavingRename] = useState(false);
    const [tags, setTags] = useState<Tag[]>(allTags);
    const [filterTagId, setFilterTagId] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [providers, setProviders] = useState<
        Array<{
            id: string;
            provider: string;
            baseUrl: string | null;
            defaultModel: string | null;
            isDefaultTranscription: boolean;
            isDefaultEnhancement: boolean;
            createdAt: Date;
        }>
    >([]);

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

    useEffect(() => {
        if (settingsOpen) {
            fetch("/api/settings/ai/providers")
                .then((res) => res.json())
                .then((data) => setProviders(data.providers || []))
                .catch(() => setProviders([]));
        }
    }, [settingsOpen]);

    const handleTranscribe = useCallback(async () => {
        if (!currentRecording) return;

        setIsTranscribing(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/transcribe`,
                { method: "POST" },
            );

            if (response.ok) {
                const data = await response.json();
                toast.success("Transcription complete");
                if (data.compressionWarning) {
                    toast.warning(data.compressionWarning, { duration: 10000 });
                }
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Transcription failed");
            }
        } catch {
            toast.error("Failed to transcribe recording");
        } finally {
            setIsTranscribing(false);
        }
    }, [currentRecording, router]);

    const handleRetranscribe = useCallback(async () => {
        if (!currentRecording) return;

        setIsTranscribing(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/transcribe`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ force: true }),
                },
            );

            if (response.ok) {
                const data = await response.json();
                toast.success("Re-transcription complete");
                if (data.compressionWarning) {
                    toast.warning(data.compressionWarning, { duration: 10000 });
                }
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Re-transcription failed");
            }
        } catch {
            toast.error("Failed to re-transcribe recording");
        } finally {
            setIsTranscribing(false);
        }
    }, [currentRecording, router]);

    const handleRenameStart = useCallback(() => {
        if (!currentRecording) return;
        setRenameValue(currentRecording.filename);
        setIsRenaming(true);
    }, [currentRecording]);

    const handleRenameCancel = useCallback(() => {
        setIsRenaming(false);
        setRenameValue("");
    }, []);

    const handleRenameSave = useCallback(async () => {
        if (!currentRecording) return;
        const newName = renameValue.trim();
        if (!newName || newName === currentRecording.filename) {
            handleRenameCancel();
            return;
        }

        setIsSavingRename(true);
        try {
            const response = await fetch(
                `/api/recordings/${currentRecording.id}/rename`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: newName }),
                },
            );

            if (!response.ok) {
                const error = await response.json();
                toast.error(error.error || "Failed to rename");
                return;
            }

            setCurrentRecording((prev) =>
                prev ? { ...prev, filename: newName } : prev,
            );
            setIsRenaming(false);
            toast.success("Renamed");
            router.refresh();
        } catch {
            toast.error("Failed to rename");
        } finally {
            setIsSavingRename(false);
        }
    }, [currentRecording, renameValue, handleRenameCancel, router]);

    const handleDelete = useCallback(async () => {
        if (!currentRecording) return;
        if (
            !confirm(
                `Delete "${currentRecording.filename}"? This will remove the recording and its transcription permanently.`,
            )
        ) {
            return;
        }

        try {
            const response = await fetch(
                `/api/voice-memos/${currentRecording.id}`,
                { method: "DELETE" },
            );

            if (response.ok) {
                toast.success("Voice memo deleted");
                setCurrentRecording(null);
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to delete");
            }
        } catch {
            toast.error("Failed to delete voice memo");
        }
    }, [currentRecording, router]);

    const refreshTags = useCallback(async () => {
        try {
            const res = await fetch("/api/tags");
            if (res.ok) {
                const data = await res.json();
                setTags(data.tags ?? []);
            }
        } catch {
            // best-effort
        }
    }, []);

    const handleTagsChanged = useCallback(
        (recordingId: string, newTags: Tag[]) => {
            setCurrentRecording((prev) =>
                prev?.id === recordingId ? { ...prev, tags: newTags } : prev,
            );
            router.refresh();
        },
        [router],
    );

    const [isExporting, setIsExporting] = useState(false);

    const handlePushToObsidian = useCallback(
        async (options?: { silent?: boolean }) => {
            if (!currentRecording) return;

            const silent = options?.silent ?? false;
            setIsExporting(true);
            try {
                const response = await fetch(
                    `/api/recordings/${currentRecording.id}/export-obsidian`,
                    { method: "POST" },
                );

                const data = await response.json();

                if (response.ok) {
                    toast.success(`Pushed to Obsidian: ${data.vaultPath}`);
                } else if (!silent) {
                    toast.error(data.error || "Failed to push to Obsidian");
                }
            } catch {
                if (!silent) toast.error("Failed to push to Obsidian");
            } finally {
                setIsExporting(false);
            }
        },
        [currentRecording],
    );

    const handleSpeakerMapChanged = useCallback(
        (map: Record<string, string>) => {
            if (!currentRecording) return;
            const key = currentRecording.id;
            const existing = transcriptions.get(key);
            if (existing) {
                transcriptions.set(key, { ...existing, speakerMap: map });
            }
            router.refresh();
            handlePushToObsidian({ silent: true });
        },
        [currentRecording, transcriptions, router, handlePushToObsidian],
    );

    const handleUploadComplete = useCallback(() => {
        router.refresh();
    }, [router]);

    return (
        <>
            <div className="bg-background">
                <div className="container mx-auto px-4 py-6 max-w-7xl">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-3xl font-bold">Voice Memos</h1>
                            <p className="text-muted-foreground text-sm mt-1">
                                {recordings.length} memo
                                {recordings.length !== 1 ? "s" : ""}{" "}
                                <span className="mx-1">·</span>
                                <Link
                                    href="/dashboard"
                                    className="text-primary hover:underline"
                                >
                                    Plaud Recordings
                                </Link>
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                onClick={() => setSettingsOpen(true)}
                                variant="outline"
                                size="icon"
                            >
                                <Settings className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="mb-6">
                        <UploadZone onUploadComplete={handleUploadComplete} />
                    </div>

                    {recordings.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <Mic className="w-16 h-16 text-muted-foreground mb-4" />
                                <h3 className="text-lg font-semibold mb-2">
                                    No voice memos yet
                                </h3>
                                <p className="text-muted-foreground text-sm text-center max-w-md">
                                    Upload audio files from your phone or other
                                    recording devices to transcribe and process
                                    them.
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1">
                                <RecordingList
                                    recordings={recordings}
                                    currentRecording={currentRecording}
                                    onSelect={setCurrentRecording}
                                    allTags={tags}
                                    filterTagId={filterTagId}
                                    onFilterTag={setFilterTagId}
                                />
                            </div>

                            <div className="lg:col-span-2 space-y-6">
                                {currentRecording ? (
                                    <>
                                        <div className="flex items-center gap-3">
                                            {isRenaming ? (
                                                <div className="flex items-center gap-2 flex-1">
                                                    <Input
                                                        value={renameValue}
                                                        onChange={(e) =>
                                                            setRenameValue(
                                                                e.target.value,
                                                            )
                                                        }
                                                        onKeyDown={(e) => {
                                                            if (
                                                                e.key ===
                                                                "Enter"
                                                            )
                                                                handleRenameSave();
                                                            if (
                                                                e.key ===
                                                                "Escape"
                                                            )
                                                                handleRenameCancel();
                                                        }}
                                                        className="text-lg font-semibold h-auto py-1"
                                                        autoFocus
                                                        disabled={
                                                            isSavingRename
                                                        }
                                                    />
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        onClick={
                                                            handleRenameSave
                                                        }
                                                        disabled={
                                                            isSavingRename
                                                        }
                                                    >
                                                        <CheckCircle className="w-5 h-5 text-green-500" />
                                                    </Button>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        onClick={
                                                            handleRenameCancel
                                                        }
                                                        disabled={
                                                            isSavingRename
                                                        }
                                                    >
                                                        <X className="w-5 h-5" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <>
                                                    <h2 className="text-lg font-semibold truncate flex-1">
                                                        {
                                                            currentRecording.filename
                                                        }
                                                    </h2>
                                                    <Button
                                                        size="icon"
                                                        variant="outline"
                                                        onClick={
                                                            handleRenameStart
                                                        }
                                                        title="Rename"
                                                        className="shrink-0"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        size="icon"
                                                        variant="outline"
                                                        onClick={handleDelete}
                                                        title="Delete voice memo"
                                                        className="shrink-0 text-destructive hover:text-destructive"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>

                                        <TagAssignment
                                            recording={currentRecording}
                                            allTags={tags}
                                            onTagsChanged={handleTagsChanged}
                                            onTagCreated={refreshTags}
                                        />

                                        <RecordingPlayer
                                            recording={currentRecording}
                                            onEnded={() => {
                                                const currentIndex =
                                                    recordings.findIndex(
                                                        (r) =>
                                                            r.id ===
                                                            currentRecording.id,
                                                    );
                                                if (
                                                    currentIndex >= 0 &&
                                                    currentIndex <
                                                        recordings.length - 1
                                                ) {
                                                    setCurrentRecording(
                                                        recordings[
                                                            currentIndex + 1
                                                        ],
                                                    );
                                                }
                                            }}
                                        />

                                        <TranscriptionPanel
                                            recording={currentRecording}
                                            transcription={currentTranscription}
                                            isTranscribing={isTranscribing}
                                            onTranscribe={handleTranscribe}
                                            onRetranscribe={handleRetranscribe}
                                            onSpeakerMapChanged={
                                                handleSpeakerMapChanged
                                            }
                                        />

                                        {currentTranscription?.text && (
                                            <div className="flex justify-end">
                                                <Button
                                                    onClick={() =>
                                                        handlePushToObsidian()
                                                    }
                                                    disabled={isExporting}
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    <BookOpen className="w-4 h-4 mr-2" />
                                                    {isExporting
                                                        ? "Pushing..."
                                                        : "Push to Obsidian"}
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <Card>
                                        <CardContent className="py-16 text-center">
                                            <p className="text-muted-foreground">
                                                Select a voice memo to view
                                                details and transcription
                                            </p>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                initialProviders={providers}
                tags={tags}
                onTagsChanged={refreshTags}
                onReRunOnboarding={() => {
                    setSettingsOpen(false);
                }}
            />
        </>
    );
}
