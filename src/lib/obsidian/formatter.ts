interface TranscriptMetadata {
    title: string;
    date: Date;
    duration?: number;
    language?: string | null;
    recordingId: string;
    provider?: string;
    model?: string;
    summary?: string | null;
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

export function formatTranscriptMarkdown(
    transcriptionText: string,
    metadata: TranscriptMetadata,
): string {
    const frontmatter: string[] = [
        "---",
        `title: ${escapeYaml(metadata.title)}`,
        `date: ${metadata.date.toISOString()}`,
        "tags:",
        "  - transcription",
        "  - plaud",
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

    frontmatter.push("---");

    const parts = [
        frontmatter.join("\n"),
        "",
        `# ${metadata.title}`,
        "",
        transcriptionText,
    ];

    if (metadata.summary) {
        parts.push("", "## Summary", "", metadata.summary);
    }

    return parts.join("\n") + "\n";
}

export function generateVaultPath(vaultBasePath: string, title: string, date: Date): string {
    const dateStr = date.toISOString().split("T")[0];
    const safeTitle = title.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
    const filename = `${dateStr} - ${safeTitle}.md`;
    const basePath = vaultBasePath.replace(/\/$/, "");
    return `${basePath}/${filename}`;
}
