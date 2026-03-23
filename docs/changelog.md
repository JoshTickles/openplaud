# Changelog

- [Added]: Recording rename API route (`PATCH /api/recordings/[id]/rename`) with Plaud cloud sync-back support (josh, 2026-03-24)
- [Added]: Obsidian integration library (`src/lib/obsidian/`) with REST API client and Markdown formatter including YAML frontmatter generation (josh, 2026-03-24)
- [Added]: Obsidian export API route (`POST /api/recordings/[id]/export-obsidian`) to push transcriptions as formatted notes to Obsidian vaults (josh, 2026-03-24)
- [Added]: AI enhancements API route (`POST /api/recordings/[id]/enhance`) for generating summaries, action items, and key points from transcriptions using OpenAI-compatible providers (josh, 2026-03-24)
- [Changed]: Recording detail route (`GET /api/recordings/[id]`) now returns `enhancement` alongside `recording` and `transcription` (josh, 2026-03-24)
