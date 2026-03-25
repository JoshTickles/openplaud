"use client";

import { Check, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Recording, Tag } from "@/types/recording";

interface TagAssignmentProps {
    recording: Recording;
    allTags: Tag[];
    onTagsChanged: (recordingId: string, tags: Tag[]) => void;
    onTagCreated: () => void;
}

const TAG_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#22c55e",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#f97316",
];

export function TagAssignment({
    recording,
    allTags,
    onTagsChanged,
    onTagCreated,
}: TagAssignmentProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [newTagName, setNewTagName] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const assignedIds = new Set((recording.tags ?? []).map((t) => t.id));

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    const toggleTag = useCallback(
        async (tag: Tag) => {
            const currentTags = recording.tags ?? [];
            const isAssigned = assignedIds.has(tag.id);
            const newTagIds = isAssigned
                ? currentTags.filter((t) => t.id !== tag.id).map((t) => t.id)
                : [...currentTags.map((t) => t.id), tag.id];

            try {
                const res = await fetch(`/api/recordings/${recording.id}/tags`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tagIds: newTagIds }),
                });

                if (!res.ok) {
                    const err = await res.json();
                    toast.error(err.error || "Failed to update tags");
                    return;
                }

                const data = await res.json();
                onTagsChanged(recording.id, data.tags);
            } catch {
                toast.error("Failed to update tags");
            }
        },
        [recording, assignedIds, onTagsChanged],
    );

    const createTag = useCallback(async () => {
        const name = newTagName.trim();
        if (!name) return;

        setIsCreating(true);
        try {
            const color = TAG_COLORS[allTags.length % TAG_COLORS.length];
            const res = await fetch("/api/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, color }),
            });

            if (!res.ok) {
                const err = await res.json();
                toast.error(err.error || "Failed to create tag");
                return;
            }

            setNewTagName("");
            onTagCreated();
            toast.success(`Tag "${name}" created`);
        } catch {
            toast.error("Failed to create tag");
        } finally {
            setIsCreating(false);
        }
    }, [newTagName, allTags.length, onTagCreated]);

    return (
        <div className="flex items-center gap-2 flex-wrap relative" ref={dropdownRef}>
            {(recording.tags ?? []).map((tag) => (
                <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                >
                    {tag.name}
                    <button
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className="hover:opacity-70 ml-0.5"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </span>
            ))}

            <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsOpen(!isOpen)}
                className="h-6 w-6 p-0 rounded-full"
                title="Add tag"
            >
                <Plus className="w-3.5 h-3.5" />
            </Button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-popover border rounded-lg shadow-lg p-2 min-w-[200px]">
                    {allTags.length > 0 && (
                        <div className="max-h-48 overflow-y-auto space-y-1 mb-2">
                            {allTags.map((tag) => (
                                <button
                                    key={tag.id}
                                    type="button"
                                    onClick={() => toggleTag(tag)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent text-sm text-left"
                                >
                                    <span
                                        className="w-3 h-3 rounded-full shrink-0"
                                        style={{ backgroundColor: tag.color }}
                                    />
                                    <span className="flex-1 truncate">{tag.name}</span>
                                    {assignedIds.has(tag.id) && (
                                        <Check className="w-4 h-4 text-green-500 shrink-0" />
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center gap-1 border-t pt-2">
                        <Input
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") createTag();
                            }}
                            placeholder="New tag..."
                            className="h-7 text-xs"
                            disabled={isCreating}
                            maxLength={50}
                        />
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={createTag}
                            disabled={!newTagName.trim() || isCreating}
                            className="h-7 px-2"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
