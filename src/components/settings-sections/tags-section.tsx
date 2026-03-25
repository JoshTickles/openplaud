"use client";

import { Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Tag {
    id: string;
    name: string;
    color: string;
}

interface TagsSectionProps {
    tags: Tag[];
    onTagsChanged?: () => void;
}

const COLOR_PALETTE = [
    "#3b82f6",
    "#ef4444",
    "#22c55e",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#f97316",
    "#6366f1",
    "#14b8a6",
    "#e11d48",
    "#84cc16",
];

export function TagsSection({ tags, onTagsChanged }: TagsSectionProps) {
    const [newTagName, setNewTagName] = useState("");
    const [newTagColor, setNewTagColor] = useState(COLOR_PALETTE[0]);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editColor, setEditColor] = useState("");

    const createTag = useCallback(async () => {
        const name = newTagName.trim();
        if (!name) return;

        setIsCreating(true);
        try {
            const res = await fetch("/api/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, color: newTagColor }),
            });

            if (!res.ok) {
                const err = await res.json();
                toast.error(err.error || "Failed to create tag");
                return;
            }

            setNewTagName("");
            setNewTagColor(
                COLOR_PALETTE[(tags.length + 1) % COLOR_PALETTE.length],
            );
            toast.success(`Tag "${name}" created`);
            onTagsChanged?.();
        } catch {
            toast.error("Failed to create tag");
        } finally {
            setIsCreating(false);
        }
    }, [newTagName, newTagColor, tags.length, onTagsChanged]);

    const deleteTag = useCallback(
        async (tag: Tag) => {
            if (!confirm(`Delete tag "${tag.name}"? This will remove it from all recordings.`)) {
                return;
            }

            try {
                const res = await fetch(`/api/tags/${tag.id}`, {
                    method: "DELETE",
                });

                if (!res.ok) {
                    toast.error("Failed to delete tag");
                    return;
                }

                toast.success(`Tag "${tag.name}" deleted`);
                onTagsChanged?.();
            } catch {
                toast.error("Failed to delete tag");
            }
        },
        [onTagsChanged],
    );

    const startEdit = useCallback((tag: Tag) => {
        setEditingId(tag.id);
        setEditName(tag.name);
        setEditColor(tag.color);
    }, []);

    const cancelEdit = useCallback(() => {
        setEditingId(null);
        setEditName("");
        setEditColor("");
    }, []);

    const saveEdit = useCallback(async () => {
        if (!editingId) return;
        const name = editName.trim();
        if (!name) return;

        try {
            const res = await fetch(`/api/tags/${editingId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, color: editColor }),
            });

            if (!res.ok) {
                const err = await res.json();
                toast.error(err.error || "Failed to update tag");
                return;
            }

            toast.success("Tag updated");
            cancelEdit();
            onTagsChanged?.();
        } catch {
            toast.error("Failed to update tag");
        }
    }, [editingId, editName, editColor, cancelEdit, onTagsChanged]);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2 mb-2">
                <Tags className="w-5 h-5" />
                <h3 className="text-lg font-semibold">Tags</h3>
            </div>
            <p className="text-sm text-muted-foreground">
                Create and manage tags to categorize your recordings.
            </p>

            <div className="space-y-3">
                <Label>Create New Tag</Label>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                        {COLOR_PALETTE.map((c) => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => setNewTagColor(c)}
                                className="w-5 h-5 rounded-full border-2 transition-transform"
                                style={{
                                    backgroundColor: c,
                                    borderColor:
                                        newTagColor === c
                                            ? "white"
                                            : "transparent",
                                    transform:
                                        newTagColor === c
                                            ? "scale(1.2)"
                                            : "scale(1)",
                                }}
                            />
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: newTagColor }}
                    />
                    <Input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") createTag();
                        }}
                        placeholder="Tag name..."
                        maxLength={50}
                        disabled={isCreating}
                    />
                    <Button
                        onClick={createTag}
                        disabled={!newTagName.trim() || isCreating}
                        size="sm"
                    >
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                    </Button>
                </div>
            </div>

            {tags.length > 0 && (
                <div className="space-y-3">
                    <Label>Existing Tags ({tags.length})</Label>
                    <div className="space-y-2">
                        {tags.map((tag) => (
                            <div
                                key={tag.id}
                                className="flex items-center gap-2 p-2 rounded-lg border"
                            >
                                {editingId === tag.id ? (
                                    <>
                                        <div className="flex items-center gap-1 flex-wrap">
                                            {COLOR_PALETTE.map((c) => (
                                                <button
                                                    key={c}
                                                    type="button"
                                                    onClick={() =>
                                                        setEditColor(c)
                                                    }
                                                    className="w-4 h-4 rounded-full border-2 transition-transform"
                                                    style={{
                                                        backgroundColor: c,
                                                        borderColor:
                                                            editColor === c
                                                                ? "white"
                                                                : "transparent",
                                                        transform:
                                                            editColor === c
                                                                ? "scale(1.2)"
                                                                : "scale(1)",
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <Input
                                            value={editName}
                                            onChange={(e) =>
                                                setEditName(e.target.value)
                                            }
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter")
                                                    saveEdit();
                                                if (e.key === "Escape")
                                                    cancelEdit();
                                            }}
                                            className="flex-1 h-8"
                                            maxLength={50}
                                            autoFocus
                                        />
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={saveEdit}
                                            className="h-8 w-8"
                                        >
                                            <Plus className="w-4 h-4 text-green-500" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={cancelEdit}
                                            className="h-8 w-8"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <span
                                            className="w-4 h-4 rounded-full shrink-0"
                                            style={{
                                                backgroundColor: tag.color,
                                            }}
                                        />
                                        <span className="flex-1 text-sm font-medium">
                                            {tag.name}
                                        </span>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => startEdit(tag)}
                                            className="h-8 w-8"
                                            title="Edit tag"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => deleteTag(tag)}
                                            className="h-8 w-8 text-destructive hover:text-destructive"
                                            title="Delete tag"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {tags.length === 0 && (
                <p className="text-sm text-muted-foreground italic">
                    No tags created yet. Add one above to start categorizing
                    your recordings.
                </p>
            )}
        </div>
    );
}
