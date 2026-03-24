# Changelog

- [Changed]: Updated fork state tracking with current remaining work and planned Google Speech diarization feature scope/config requirements (josh, 2026-03-24)
- [Added]: Local speaker diarization toggle and speaker-count settings wired into transcription flow with `diarized_json` request mode and automatic fallback to `verbose_json` when provider support is unavailable (josh, 2026-03-24)
- [Fixed]: Refactored `/api/recordings/[id]/transcribe` to use the provider abstraction path, enabling successful Azure Whisper transcription via LiteLLM for Plaud audio (josh, 2026-03-24)

- [Added]: Obsidian settings UI section (API URL, key, vault path, auto-export, test connection), recording workstation enhanced with inline rename/enhance panel/Obsidian export, DB migration 0011, docker-compose updated to build from fork source, unit tests for audio format detection and provider factory (josh, 2026-03-23)

- [Added]: Recording rename API route (`PATCH /api/recordings/[id]/rename`) with Plaud cloud sync-back support (josh, 2026-03-24)
- [Added]: Obsidian integration library (`src/lib/obsidian/`) with REST API client and Markdown formatter including YAML frontmatter generation (josh, 2026-03-24)
- [Added]: Obsidian export API route (`POST /api/recordings/[id]/export-obsidian`) to push transcriptions as formatted notes to Obsidian vaults (josh, 2026-03-24)
- [Added]: AI enhancements API route (`POST /api/recordings/[id]/enhance`) for generating summaries, action items, and key points from transcriptions using OpenAI-compatible providers (josh, 2026-03-24)
- [Changed]: Recording detail route (`GET /api/recordings/[id]`) now returns `enhancement` alongside `recording` and `transcription` (josh, 2026-03-24)
