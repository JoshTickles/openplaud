# Changelog

- [Added]: APAC server entry (api-apse1.plaud.ai) to Plaud server configuration (josh, 2026-03-24)
- [Added]: Audio format detection utility (`detect-format.ts`) that identifies OGG/Opus, MP3, WAV, and FLAC from magic bytes — fixes Plaud misnamed .mp3 files that are actually Opus (josh, 2026-03-24)
- [Added]: Transcription provider abstraction with OpenAI, Azure, and LiteLLM providers — replaces monolithic transcription logic with pluggable provider pattern (josh, 2026-03-24)
- [Added]: Provider factory and `inferProviderType` for backward-compatible provider resolution from existing credentials (josh, 2026-03-24)
- [Changed]: Refactored `transcribe-recording.ts` to use provider abstraction, removing inline OpenAI SDK usage and format detection (josh, 2026-03-24)
