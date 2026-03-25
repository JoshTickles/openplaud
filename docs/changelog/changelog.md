# Changelog

- [Added]: Comprehensive test coverage for new features — 75 new tests across 4 files: ensureSpeakerBlankLines (11), Obsidian formatter/vault path/speaker map/YAML escape (32), tags API validation (18), speaker-map API validation (14); total suite now 137 tests (josh, 2026-03-25)
- [Fixed]: Resolved all merge conflict markers left from prior upstream merge attempt — cleaned 6 files including transcribe-recording.ts, sync-recordings.ts, servers.ts, Dockerfile, _journal.json, transcription.test.ts (josh, 2026-03-25)
- [Changed]: Reviewed upstream 49 commits; all useful features already present in fork — no merge needed, updated provider-factory test for mandatory GOOGLE_PROJECT_ID (josh, 2026-03-25)
- [Fixed]: Removed all hardcoded secrets, internal IPs, and infrastructure details from code and git history using git-filter-repo; all sensitive values now come from environment variables only (josh, 2026-03-25)
- [Added]: Implemented Google Speech diarization provider with runtime-only service-account configuration and provider routing support for speaker-labeled transcripts (josh, 2026-03-24)
- [Added]: APAC server entry (api-apse1.plaud.ai) to Plaud server configuration (josh, 2026-03-24)
- [Added]: Audio format detection utility (`detect-format.ts`) that identifies OGG/Opus, MP3, WAV, and FLAC from magic bytes — fixes Plaud misnamed .mp3 files that are actually Opus (josh, 2026-03-24)
- [Added]: Transcription provider abstraction with OpenAI, Azure, and LiteLLM providers — replaces monolithic transcription logic with pluggable provider pattern (josh, 2026-03-24)
- [Added]: Provider factory and `inferProviderType` for backward-compatible provider resolution from existing credentials (josh, 2026-03-24)
- [Changed]: Refactored `transcribe-recording.ts` to use provider abstraction, removing inline OpenAI SDK usage and format detection (josh, 2026-03-24)
