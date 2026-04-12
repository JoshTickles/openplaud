"use client";

import { BookOpen, CheckCircle, CloudOff, Mic, Pencil, RefreshCw, Settings, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { SyncStatus } from "@/components/sync-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAutoSync } from "@/hooks/use-auto-sync";
import {
    requestNotificationPermission,
    showNewRecordingNotification,
    showSyncCompleteNotification,
} from "@/lib/notifications/browser";
import { getSyncSettings, SYNC_CONFIG } from "@/lib/sync-config";
import type { Recording, Tag } from "@/types/recording";
import { RecordingList } from "./recording-list";
import { RecordingPlayer } from "./recording-player";
import { TagAssignment } from "./tag-assignment";
import { TranscriptionPanel } from "./transcription-panel";

interface TranscriptionData {
    text?: string;
    language?: string;
    speakerMap?: Record<string, string>;
}

interface WorkstationProps {
    recordings: Recording[];
    transcriptions: Map<string, TranscriptionData>;
    allTags: Tag[];
}

export function Workstation({ recordings, transcriptions, allTags }: WorkstationProps) {
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
    const [onboardingOpen, setOnboardingOpen] = useState(false);
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
    const [syncSettings, setSyncSettings] = useState<{
        syncInterval: number;
        autoSyncEnabled: boolean;
        syncOnMount: boolean;
        syncOnVisibilityChange: boolean;
        syncNotifications: boolean;
    } | null>(null);
    const [notificationPrefs, setNotificationPrefs] = useState<{
        browserNotifications: boolean;
    } | null>(null);

    const currentTranscription = currentRecording
        ? transcriptions.get(currentRecording.id)
        : undefined;

    useEffect(() => {
        getSyncSettings().then(setSyncSettings);
    }, []);

    useEffect(() => {
        const fetchNotificationPrefs = async () => {
            try {
                const res = await fetch("/api/settings/user");
                if (!res.ok) return;
                const data = await res.json();
                setNotificationPrefs({
                    browserNotifications: data.browserNotifications ?? true,
                });
            } catch {
                // best-effort; ignore
            }
        };

        fetchNotificationPrefs();
    }, []);

    useEffect(() => {
        if (!settingsOpen) {
            getSyncSettings().then(setSyncSettings);
        }
    }, [settingsOpen]);

    const {
        isAutoSyncing,
        lastSyncTime,
        nextSyncTime,
        lastSyncResult,
        manualSync,
    } = useAutoSync({
        interval: syncSettings?.syncInterval ?? SYNC_CONFIG.defaultInterval,
        minInterval: SYNC_CONFIG.minInterval,
        syncOnMount: syncSettings?.syncOnMount ?? SYNC_CONFIG.syncOnMount,
        syncOnVisibilityChange:
            syncSettings?.syncOnVisibilityChange ??
            SYNC_CONFIG.syncOnVisibilityChange,
        enabled: syncSettings?.autoSyncEnabled ?? true,
        onSuccess: (newRecordings) => {
            if (syncSettings?.syncNotifications !== false) {
                if (newRecordings > 0) {
                    toast.success(
                        `Synced ${newRecordings} new recording${newRecordings !== 1 ? "s" : ""}`,
                    );
                } else {
                    toast.success("Sync complete - no new recordings");
                }
            }

            if (notificationPrefs?.browserNotifications) {
                (async () => {
                    const granted = await requestNotificationPermission();
                    if (!granted) return;

                    if (newRecordings > 0) {
                        showNewRecordingNotification(newRecordings);
                    } else {
                        showSyncCompleteNotification();
                    }
                })();
            }
        },
        onError: (error) => {
            toast.error(error);
        },
    });

    const handleSync = useCallback(async () => {
        await manualSync();
    }, [manualSync]);

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
                {
                    method: "POST",
                },
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
                toast.error(error.error || "Failed to rename recording");
                return;
            }

            setCurrentRecording((prev) =>
                prev ? { ...prev, filename: newName } : prev,
            );
            setIsRenaming(false);
            toast.success("Recording renamed & synced to Plaud");
            router.refresh();
        } catch {
            toast.error("Failed to rename recording");
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
                `/api/recordings/${currentRecording.id}`,
                { method: "DELETE" },
            );

            if (response.ok) {
                toast.success("Recording deleted");
                setCurrentRecording(null);
                router.refresh();
            } else {
                const error = await response.json();
                toast.error(error.error || "Failed to delete recording");
            }
        } catch {
            toast.error("Failed to delete recording");
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
                prev?.id === recordingId
                    ? { ...prev, tags: newTags }
                    : prev,
            );
            router.refresh();
        },
        [router],
    );

    const [isExporting, setIsExporting] = useState(false);

    const handlePushToObsidian = useCallback(async (options?: { silent?: boolean }) => {
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
    }, [currentRecording]);

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

    return (
        <>
            <div className="bg-background">
                <div className="container mx-auto px-4 py-6 max-w-7xl">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-3xl font-bold">Recordings</h1>
                            <p className="text-muted-foreground text-sm mt-1">
                                {recordings.length} recording
                                {recordings.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <SyncStatus
                                lastSyncTime={lastSyncTime}
                                nextSyncTime={nextSyncTime}
                                isAutoSyncing={isAutoSyncing}
                                lastSyncResult={lastSyncResult}
                                className="hidden md:flex"
                            />
                            <Button
                                onClick={handleSync}
                                disabled={isAutoSyncing}
                                variant="outline"
                                size="sm"
                                className="h-9"
                            >
                                {isAutoSyncing ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2" />
                                        Sync Device
                                    </>
                                )}
                            </Button>
                            <Button
                                onClick={() => setSettingsOpen(true)}
                                variant="outline"
                                size="icon"
                            >
                                <Settings className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    {recordings.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <Mic className="w-16 h-16 text-muted-foreground mb-4" />
                                <h3 className="text-lg font-semibold mb-2">
                                    No recordings yet
                                </h3>
                                <p className="text-muted-foreground text-sm mb-6 text-center max-w-md">
                                    Sync your Plaud device to import your
                                    recordings and start transcribing them.
                                </p>
                                <Button
                                    onClick={handleSync}
                                    disabled={isAutoSyncing}
                                >
                                    {isAutoSyncing ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                            Syncing...
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw className="w-4 h-4 mr-2" />
                                            Sync Device
                                        </>
                                    )}
                                </Button>
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
                                        {/* Recording title with rename */}
                                        <div className="flex items-center gap-3">
                                            {isRenaming ? (
                                                <div className="flex items-center gap-2 flex-1">
                                                    <Input
                                                        value={renameValue}
                                                        onChange={(e) => setRenameValue(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") handleRenameSave();
                                                            if (e.key === "Escape") handleRenameCancel();
                                                        }}
                                                        className="text-lg font-semibold h-auto py-1"
                                                        autoFocus
                                                        disabled={isSavingRename}
                                                    />
                                                    <Button size="icon" variant="ghost" onClick={handleRenameSave} disabled={isSavingRename}>
                                                        <CheckCircle className="w-5 h-5 text-green-500" />
                                                    </Button>
                                                    <Button size="icon" variant="ghost" onClick={handleRenameCancel} disabled={isSavingRename}>
                                                        <X className="w-5 h-5" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <>
                                                    <h2 className="text-lg font-semibold truncate flex-1">
                                                        {currentRecording.filename}
                                                    </h2>
                                                    {currentRecording.upstreamDeleted && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-500/20 text-amber-400 shrink-0">
                                                            <CloudOff className="w-3 h-3" />
                                                            Local only
                                                        </span>
                                                    )}
                                                    <Button
                                                        size="icon"
                                                        variant="outline"
                                                        onClick={handleRenameStart}
                                                        title="Rename and sync to Plaud"
                                                        className="shrink-0"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    {currentRecording.upstreamDeleted && (
                                                        <Button
                                                            size="icon"
                                                            variant="outline"
                                                            onClick={handleDelete}
                                                            title="Delete local recording"
                                                            className="shrink-0 text-destructive hover:text-destructive"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    )}
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
                                            onSpeakerMapChanged={handleSpeakerMapChanged}
                                        />
                                        {currentTranscription?.text && (
                                            <div className="flex justify-end">
                                                <Button
                                                    onClick={() => handlePushToObsidian()}
                                                    disabled={isExporting}
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    <BookOpen className="w-4 h-4 mr-2" />
                                                    {isExporting ? "Pushing..." : "Push to Obsidian"}
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <Card>
                                        <CardContent className="py-16 text-center">
                                            <p className="text-muted-foreground">
                                                Select a recording to view
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
                    setOnboardingOpen(true);
                }}
            />

            <OnboardingDialog
                open={onboardingOpen}
                onOpenChange={setOnboardingOpen}
                onComplete={() => {
                    setOnboardingOpen(false);
                    router.refresh();
                }}
            />
        </>
    );
}
