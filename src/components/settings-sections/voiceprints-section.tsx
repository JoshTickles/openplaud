"use client";

import {
    Check,
    ChevronDown,
    ChevronRight,
    Fingerprint,
    Pause,
    Pencil,
    Play,
    Trash2,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Sample {
    id: string;
    recordingId: string;
    recordingName: string | null;
    segStart: number | null;
    segEnd: number | null;
}

interface Voiceprint {
    id: string;
    name: string;
    sampleCount: number;
    updatedAt: string;
    samples: Sample[];
}

function fmtTime(s: number | null): string {
    if (s == null) return "";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function VoiceprintsSection() {
    const [voiceprints, setVoiceprints] = useState<Voiceprint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [playingSampleId, setPlayingSampleId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/settings/voiceprints");
                if (res.ok) {
                    const data = await res.json();
                    setVoiceprints(data.voiceprints ?? []);
                }
            } catch {
                toast.error("Failed to load voiceprints");
            } finally {
                setIsLoading(false);
            }
        })();
        return () => {
            audioRef.current?.pause();
        };
    }, []);

    const toggleExpand = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const playSnippet = (sample: Sample) => {
        // Stop any current playback.
        audioRef.current?.pause();
        if (playingSampleId === sample.id) {
            setPlayingSampleId(null);
            return;
        }

        const start = sample.segStart ?? 0;
        const end = sample.segEnd ?? start + 10;
        const audio = new Audio(
            `/api/recordings/${sample.recordingId}/audio#t=${start}`,
        );
        audioRef.current = audio;
        audio.currentTime = start;
        const onTime = () => {
            if (audio.currentTime >= end) {
                audio.pause();
                setPlayingSampleId(null);
                audio.removeEventListener("timeupdate", onTime);
            }
        };
        audio.addEventListener("timeupdate", onTime);
        audio.addEventListener("ended", () => setPlayingSampleId(null));
        audio
            .play()
            .then(() => setPlayingSampleId(sample.id))
            .catch(() => {
                toast.error("Could not play audio");
                setPlayingSampleId(null);
            });
    };

    const startEdit = (vp: Voiceprint) => {
        setEditingId(vp.id);
        setEditValue(vp.name);
    };
    const cancelEdit = () => {
        setEditingId(null);
        setEditValue("");
    };

    const saveEdit = async (id: string) => {
        const name = editValue.trim();
        if (!name) return;
        setBusyId(id);
        try {
            const res = await fetch("/api/settings/voiceprints", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, name }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Rename failed");
            }
            setVoiceprints((prev) =>
                prev
                    .map((vp) => (vp.id === id ? { ...vp, name } : vp))
                    .sort((a, b) => a.name.localeCompare(b.name)),
            );
            cancelEdit();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Rename failed");
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (vp: Voiceprint) => {
        if (
            !confirm(
                `Delete the voiceprint for "${vp.name}"? Future recordings will no longer auto-suggest this person until you name them again.`,
            )
        ) {
            return;
        }
        setBusyId(vp.id);
        try {
            const res = await fetch(
                `/api/settings/voiceprints?id=${encodeURIComponent(vp.id)}`,
                { method: "DELETE" },
            );
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Delete failed");
            }
            setVoiceprints((prev) => prev.filter((x) => x.id !== vp.id));
            toast.success(`Deleted ${vp.name}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed");
        } finally {
            setBusyId(null);
        }
    };

    const handleDeleteSample = async (vp: Voiceprint, sample: Sample) => {
        setBusyId(sample.id);
        try {
            const res = await fetch(
                `/api/settings/voiceprints/samples?id=${encodeURIComponent(sample.id)}`,
                { method: "DELETE" },
            );
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Delete failed");
            }
            // Removing the last sample deletes the whole voiceprint.
            const remaining = vp.samples.filter((s) => s.id !== sample.id);
            setVoiceprints((prev) =>
                remaining.length === 0
                    ? prev.filter((x) => x.id !== vp.id)
                    : prev.map((x) =>
                          x.id === vp.id
                              ? {
                                    ...x,
                                    samples: remaining,
                                    sampleCount: remaining.length,
                                }
                              : x,
                      ),
            );
            toast.success("Sample removed");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Delete failed");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <h3 className="text-lg font-medium flex items-center gap-2">
                    <Fingerprint className="w-5 h-5" />
                    Speaker Voiceprints
                </h3>
                <p className="text-sm text-muted-foreground">
                    People you've named in transcripts. Each recording
                    contributes one voice sample; the voiceprint is the average
                    of its samples. Expand a person to play each sample and
                    remove any that were mislabelled — the voiceprint
                    recalculates automatically.
                </p>
            </div>

            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
            ) : voiceprints.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                        No voiceprints yet. Name a speaker on any diarized
                        recording and they'll appear here.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {voiceprints.map((vp) => {
                        const isOpen = expanded.has(vp.id);
                        return (
                            <div key={vp.id} className="rounded-lg border">
                                <div className="flex items-center gap-3 p-3">
                                    <button
                                        type="button"
                                        onClick={() => toggleExpand(vp.id)}
                                        className="text-muted-foreground hover:text-foreground shrink-0"
                                        aria-label={isOpen ? "Collapse" : "Expand"}
                                    >
                                        {isOpen ? (
                                            <ChevronDown className="w-4 h-4" />
                                        ) : (
                                            <ChevronRight className="w-4 h-4" />
                                        )}
                                    </button>
                                    <Fingerprint className="w-4 h-4 text-muted-foreground shrink-0" />
                                    {editingId === vp.id ? (
                                        <>
                                            <Input
                                                value={editValue}
                                                onChange={(e) =>
                                                    setEditValue(e.target.value)
                                                }
                                                className="h-8 flex-1"
                                                maxLength={100}
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter")
                                                        saveEdit(vp.id);
                                                    if (e.key === "Escape")
                                                        cancelEdit();
                                                }}
                                            />
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 shrink-0"
                                                disabled={busyId === vp.id}
                                                onClick={() => saveEdit(vp.id)}
                                            >
                                                <Check className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 shrink-0"
                                                onClick={cancelEdit}
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => toggleExpand(vp.id)}
                                                className="flex-1 text-left font-medium"
                                            >
                                                {vp.name}
                                            </button>
                                            <span className="text-xs text-muted-foreground shrink-0">
                                                {vp.sampleCount} sample
                                                {vp.sampleCount !== 1 ? "s" : ""}
                                            </span>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 shrink-0"
                                                disabled={busyId === vp.id}
                                                onClick={() => startEdit(vp)}
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                                                disabled={busyId === vp.id}
                                                onClick={() => handleDelete(vp)}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </>
                                    )}
                                </div>

                                {isOpen && (
                                    <div className="border-t px-3 py-2 space-y-1">
                                        {vp.samples.length === 0 ? (
                                            <p className="text-xs text-muted-foreground py-1">
                                                No samples.
                                            </p>
                                        ) : (
                                            vp.samples.map((s) => (
                                                <div
                                                    key={s.id}
                                                    className="flex items-center gap-2 pl-6"
                                                >
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7 shrink-0"
                                                        disabled={
                                                            s.segStart == null
                                                        }
                                                        title={
                                                            s.segStart == null
                                                                ? "No audio range for this sample"
                                                                : "Play snippet"
                                                        }
                                                        onClick={() =>
                                                            playSnippet(s)
                                                        }
                                                    >
                                                        {playingSampleId ===
                                                        s.id ? (
                                                            <Pause className="w-3.5 h-3.5" />
                                                        ) : (
                                                            <Play className="w-3.5 h-3.5" />
                                                        )}
                                                    </Button>
                                                    <span className="text-xs flex-1 truncate">
                                                        {s.recordingName ??
                                                            "Unknown recording"}
                                                    </span>
                                                    {s.segStart != null && (
                                                        <span className="text-xs text-muted-foreground shrink-0">
                                                            {fmtTime(s.segStart)}
                                                        </span>
                                                    )}
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                                                        disabled={busyId === s.id}
                                                        title="Remove this sample"
                                                        onClick={() =>
                                                            handleDeleteSample(
                                                                vp,
                                                                s,
                                                            )
                                                        }
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
