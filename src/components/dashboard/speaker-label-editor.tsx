"use client";

import { Save, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SpeakerLabelEditorProps {
    recordingId: string;
    transcriptionText: string;
    speakerMap: Record<string, string> | null;
    onSpeakerMapChanged: (map: Record<string, string>) => void;
}

const SPEAKER_COLORS = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#a855f7",
];

function extractSpeakers(text: string): string[] {
    const seen = new Set<string>();
    const speakers: string[] = [];
    const regex = /^(Speaker\s+\d+):/gim;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const normalized = match[1].replace(/\s+/g, " ");
        if (!seen.has(normalized)) {
            seen.add(normalized);
            speakers.push(normalized);
        }
    }

    return speakers;
}

export function SpeakerLabelEditor({
    recordingId,
    transcriptionText,
    speakerMap,
    onSpeakerMapChanged,
}: SpeakerLabelEditorProps) {
    const speakers = useMemo(
        () => extractSpeakers(transcriptionText),
        [transcriptionText],
    );

    const [localMap, setLocalMap] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        setLocalMap(speakerMap ?? {});
    }, [speakerMap]);

    const hasChanges = useMemo(() => {
        const saved = speakerMap ?? {};
        for (const s of speakers) {
            if ((localMap[s] ?? "") !== (saved[s] ?? "")) return true;
        }
        return false;
    }, [localMap, speakerMap, speakers]);

    const mappedCount = useMemo(
        () => speakers.filter((s) => (localMap[s] ?? "").trim().length > 0).length,
        [speakers, localMap],
    );

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            const cleanMap: Record<string, string> = {};
            for (const [key, value] of Object.entries(localMap)) {
                if (value.trim()) cleanMap[key] = value.trim();
            }

            const response = await fetch(
                `/api/recordings/${recordingId}/speaker-map`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ speakerMap: cleanMap }),
                },
            );

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "Failed to save");
            }

            onSpeakerMapChanged(cleanMap);
            toast.success("Speaker names saved");
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to save speaker names",
            );
        } finally {
            setIsSaving(false);
        }
    }, [localMap, recordingId, onSpeakerMapChanged]);

    if (speakers.length === 0) return null;

    return (
        <div className="space-y-2">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
                <Users className="w-4 h-4" />
                <span>
                    {speakers.length} speaker{speakers.length !== 1 ? "s" : ""} detected
                    {mappedCount > 0 && ` (${mappedCount} named)`}
                </span>
                <span className="text-xs">{isExpanded ? "▲" : "▼"}</span>
            </button>

            {isExpanded && (
                <div className="grid gap-2 pl-6">
                    {speakers.map((speaker, idx) => (
                        <div key={speaker} className="flex items-center gap-2">
                            <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: SPEAKER_COLORS[idx % SPEAKER_COLORS.length] }}
                            />
                            <span className="text-xs text-muted-foreground w-24 shrink-0">
                                {speaker}
                            </span>
                            <span className="text-xs text-muted-foreground">→</span>
                            <Input
                                value={localMap[speaker] ?? ""}
                                onChange={(e) =>
                                    setLocalMap((prev) => ({
                                        ...prev,
                                        [speaker]: e.target.value,
                                    }))
                                }
                                placeholder="Enter real name..."
                                className="h-7 text-xs flex-1"
                                maxLength={100}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && hasChanges) handleSave();
                                }}
                            />
                        </div>
                    ))}
                    {hasChanges && (
                        <div className="flex justify-end pt-1">
                            <Button
                                size="sm"
                                onClick={handleSave}
                                disabled={isSaving}
                                className="h-7 text-xs"
                            >
                                <Save className="w-3.5 h-3.5 mr-1" />
                                {isSaving ? "Saving..." : "Save Names"}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
