"use client";

import type { SettingsSection } from "@/types/settings";
import { DisplaySection } from "./settings-sections/display-section";
import { ExportSection } from "./settings-sections/export-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { ObsidianSection } from "./settings-sections/obsidian-section";
import { PlaybackSection } from "./settings-sections/playback-section";
import { ProvidersSection } from "./settings-sections/providers-section";
import { StorageSection } from "./settings-sections/storage-section";
import { SyncSection } from "./settings-sections/sync-section";
import { TagsSection } from "./settings-sections/tags-section";
import { TranscriptionSection } from "./settings-sections/transcription-section";

interface Provider {
    id: string;
    provider: string;
    baseUrl: string | null;
    defaultModel: string | null;
    isDefaultTranscription: boolean;
    isDefaultEnhancement: boolean;
    createdAt: Date;
}

interface SettingsContentProps {
    activeSection: SettingsSection;
    initialProviders?: Provider[];
    tags?: Array<{ id: string; name: string; color: string }>;
    onTagsChanged?: () => void;
    onReRunOnboarding?: () => void;
}

export function SettingsContent({
    activeSection,
    initialProviders = [],
    tags = [],
    onTagsChanged,
    onReRunOnboarding,
}: SettingsContentProps) {
    switch (activeSection) {
        case "providers":
            return <ProvidersSection initialProviders={initialProviders} />;
        case "transcription":
            return <TranscriptionSection />;
        case "sync":
            return <SyncSection />;
        case "playback":
            return <PlaybackSection />;
        case "display":
            return <DisplaySection />;
        case "notifications":
            return <NotificationsSection />;
        case "export":
            return <ExportSection onReRunOnboarding={onReRunOnboarding} />;
        case "storage":
            return <StorageSection />;
        case "obsidian":
            return <ObsidianSection />;
        case "tags":
            return <TagsSection tags={tags} onTagsChanged={onTagsChanged} />;
        default:
            return null;
    }
}
