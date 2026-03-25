interface TranscriptMetadata {
    title: string;
    date: Date;
    duration?: number;
    language?: string | null;
    recordingId: string;
    provider?: string;
    model?: string;
    speakerMap?: Record<string, string> | null;
    tags?: string[];
    summary?: string | null;
    actionItems?: string[] | null;
    keyPoints?: string[] | null;
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours > 0) return `${hours}h ${remainingMinutes}m ${seconds}s`;
    return `${remainingMinutes}m ${seconds}s`;
}

function escapeYaml(value: string): string {
    if (/[:"{}[\],&*?|>!%@`#]/.test(value) || value.startsWith("'") || value.startsWith('"')) {
        return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
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

export function formatTranscriptMarkdown(
    transcriptionText: string,
    metadata: TranscriptMetadata,
): string {
    const allTags = ["transcription", "plaud", ...(metadata.tags ?? [])];
    const frontmatter: string[] = [
        "---",
        `title: ${escapeYaml(metadata.title)}`,
        `date: ${metadata.date.toISOString()}`,
        "tags:",
        ...allTags.map((t) => `  - ${escapeYaml(t)}`),
        `source: plaud`,
        `recording_id: ${escapeYaml(metadata.recordingId)}`,
    ];

    if (metadata.duration) {
        frontmatter.push(`duration: ${metadata.duration}`);
        frontmatter.push(`duration_formatted: ${escapeYaml(formatDuration(metadata.duration))}`);
    }
    if (metadata.language) {
        frontmatter.push(`language: ${metadata.language}`);
    }
    if (metadata.provider) {
        frontmatter.push(`provider: ${escapeYaml(metadata.provider)}`);
    }
    if (metadata.model) {
        frontmatter.push(`model: ${escapeYaml(metadata.model)}`);
    }
    if (metadata.speakerMap && Object.keys(metadata.speakerMap).length > 0) {
        frontmatter.push("speakers:");
        for (const [label, name] of Object.entries(metadata.speakerMap)) {
            if (name.trim()) frontmatter.push(`  ${escapeYaml(label)}: ${escapeYaml(name)}`);
        }
    }

    frontmatter.push("---");

    const displayText = applySpeakerMap(transcriptionText, metadata.speakerMap);

    const parts = [
        frontmatter.join("\n"),
        "",
        `# ${metadata.title}`,
        "",
        displayText,
    ];

    if (metadata.summary) {
        parts.push("", "## Summary", "", metadata.summary);
    }

    if (metadata.keyPoints && metadata.keyPoints.length > 0) {
        parts.push("", "## Key Points", "");
        for (const point of metadata.keyPoints) {
            parts.push(`- ${point}`);
        }
    }

    if (metadata.actionItems && metadata.actionItems.length > 0) {
        parts.push("", "## Action Items", "");
        for (const item of metadata.actionItems) {
            parts.push(`- [ ] ${item}`);
        }
    }

    return parts.join("\n") + "\n";
}

export function generateVaultPath(vaultBasePath: string, title: string, _date: Date): string {
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
    const filename = `${safeTitle}.md`;
    const basePath = vaultBasePath.replace(/\/$/, "");
    return `${basePath}/${filename}`;
}
