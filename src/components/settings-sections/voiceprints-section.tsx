"use client";

import { Check, Fingerprint, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Voiceprint {
    id: string;
    name: string;
    sampleCount: number;
    updatedAt: string;
}

export function VoiceprintsSection() {
    const [voiceprints, setVoiceprints] = useState<Voiceprint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);

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
    }, []);

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

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <h3 className="text-lg font-medium flex items-center gap-2">
                    <Fingerprint className="w-5 h-5" />
                    Speaker Voiceprints
                </h3>
                <p className="text-sm text-muted-foreground">
                    People you've named in transcripts. Each recording's voice
                    fingerprints are matched against this library to suggest
                    names automatically. Naming the same person across meetings
                    sharpens their voiceprint over time.
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
                    {voiceprints.map((vp) => (
                        <div
                            key={vp.id}
                            className="flex items-center gap-3 rounded-lg border p-3"
                        >
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
                                            if (e.key === "Escape") cancelEdit();
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
                                    <span className="flex-1 font-medium">
                                        {vp.name}
                                    </span>
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
                    ))}
                </div>
            )}
        </div>
    );
}
