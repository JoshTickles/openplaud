# JoshTickles/openplaud — Fork State & Plan

> **Session continuity doc.** Update this whenever you make progress. Pick up from here on any machine or Cursor session.

## Fork Details

| Item | Value |
|------|-------|
| **Fork repo** | https://github.com/JoshTickles/openplaud |
| **Upstream** | https://github.com/openplaud/openplaud |
| **Local path** | `~/home/openplaud` |
| **Active branch** | `feature/enhanced-providers` |
| **Stack** | Next.js 16, Bun, TypeScript, Drizzle ORM, PostgreSQL 16 |

### Git Remotes
```
origin   → https://github.com/JoshTickles/openplaud.git  (your fork)
upstream → https://github.com/openplaud/openplaud.git    (upstream)
```

### Syncing with upstream
```bash
cd ~/home/openplaud
git fetch upstream
git merge upstream/main
```

---

## Infrastructure Context

| Service | Location | Notes |
|---------|----------|-------|
| **Local OpenPlaud** (Docker) | `localhost:3000` | `~/home/docker-personal/openplaud/` |
| **Local Speaches/Whisper** | `localhost:8300` | `ghcr.io/speaches-ai/speaches:latest-cpu` |
| **LiteLLM proxy** | `http://REDACTED_INTERNAL_IP` | K8s cluster, API key: `REDACTED_API_KEY` |
| **Azure Whisper** | `REDACTED_AZURE_ENDPOINT` | Deployment: `whisper`, api-version: `2024-06-01` |
| **K8s cluster** | kubeconfig: `~/home/home-k8s/kubeconfig.yaml` | RKE2, 3 nodes |

### LiteLLM Model Routing (as of 2026-03-23)
- `whisper-1` → Azure Whisper on `straker-ai-eu-product-02` ✅ tested
- `whisper-local` → speaches/faster-whisper-base on Mac `REDACTED_INTERNAL_IP:8300`
- `azure/openai-gpt-lb` → load-balanced GPT-5.2 across EU/US Azure deployments ✅ tested
- `gemini-3-flash-lb` → Gemini 3 Flash

---

## Feature Implementation Status

### ✅ Completed

#### 1. APAC Server Support
- **File**: `src/lib/plaud/servers.ts`
- Added `apac` entry pointing to `https://api-apse1.plaud.ai`
- Plaud APAC users can now connect without DB workaround
- **Workaround still needed** for existing local Docker DB (connection was manually inserted)

#### 2. Audio Format Detection
- **File**: `src/lib/audio/detect-format.ts`
- Detects Opus, MP3, WAV, FLAC from magic bytes
- Fixes the core issue: Plaud stores Opus audio with `.mp3` filenames
- Azure Whisper was rejecting files because it uses filename extension for format detection

#### 3. Multi-Provider Transcription Abstraction
- **Files**: `src/lib/transcription/providers/`
  - `types.ts` — `TranscriptionProvider` interface
  - `openai-provider.ts` — OpenAI SDK (whisper-1, gpt-4o-transcribe)
  - `azure-provider.ts` — Azure Whisper with correct file extension fix
  - `litellm-provider.ts` — LiteLLM proxy (handles Gemini, Azure, etc.)
  - `factory.ts` — `createTranscriptionProvider()` + `inferProviderType()`
  - `index.ts` — barrel export
- **Updated**: `src/lib/transcription/transcribe-recording.ts` — uses provider abstraction
- Provider type inferred from `provider` field and `baseUrl` for backward compatibility

#### 4. Recording Rename with Cloud Sync
- **File**: `src/app/api/recordings/[id]/rename/route.ts`
- `PATCH` endpoint accepting `{ filename: string }`
- Updates local DB + syncs title back to Plaud cloud via `PATCH /file/{id}`

#### 5. AI Enhancements (Summary / Action Items / Key Points)
- **File**: `src/app/api/recordings/[id]/enhance/route.ts`
- `POST` endpoint — uses existing `ai_enhancements` table (was wired up but not exposed)
- Returns `{ summary, actionItems, keyPoints }` in structured JSON
- Uses enhancement provider, falls back to transcription provider
- **Updated**: `GET /api/recordings/[id]` now returns `enhancement` alongside transcription

#### 6. Obsidian Integration
- **Files**: `src/lib/obsidian/`
  - `client.ts` — REST client for Obsidian Local REST API plugin
  - `formatter.ts` — YAML frontmatter + Markdown formatter (Dataview-compatible)
  - `index.ts` — barrel export
- **File**: `src/app/api/recordings/[id]/export-obsidian/route.ts`
  - `POST` — exports transcription + enhancement as markdown to Obsidian vault
- **Schema**: Added `obsidianConfig` JSONB column to `user_settings`
  - Structure: `{ enabled, apiUrl, apiKey (encrypted), vaultPath, autoExport }`

### ✅ Completed (Session 2 — 2026-03-23)

#### 7. Database Migration
- `src/db/migrations/0011_obsidian_config.sql` — adds `obsidian_config jsonb` to `user_settings`
- **Apply to local Docker stack**: `docker exec openplaud-db psql -U postgres openplaud -c "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS obsidian_config jsonb;"`

#### 8. Settings UI Updates
- ✅ Obsidian section in settings dialog (API URL, API key, vault path, auto-export, test connection)
- ✅ AI Enhancement panel in recording detail (Enhance button, summary/key points/action items)
- ✅ Inline rename in recording detail header (pencil icon, Enter/Escape, syncs to Plaud cloud)
- ✅ Obsidian export button in enhancement panel

#### 9. Docker Compose Update
- ✅ `~/home/docker-personal/openplaud/docker-compose.yml` updated
- Builds from `~/home/openplaud` using local fork source (`openplaud-fork:local` image)
- Removed standalone `exporter` service (Obsidian export now built into the app)

#### 10. Tests
- ✅ `src/tests/audio-format.test.ts` — detectAudioFormat magic bytes (7 tests)
- ✅ `src/tests/provider-factory.test.ts` — createTranscriptionProvider + inferProviderType (8 tests)
- ✅ Fixed pre-existing transcription.test.ts mock to work with new provider class pattern

#### 11. Build Verification
- ✅ `bun run build` passes cleanly — 28 routes including all new endpoints
- ✅ All 60 tests pass (`bun run test`)

### 🔲 Remaining

#### 12. Apply DB Migration to Running Stack
```bash
docker exec openplaud-db psql -U postgres openplaud -c \
  "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS obsidian_config jsonb;"
```

#### 13. Rebuild Local Docker Stack from Fork
```bash
cd ~/home/docker-personal/openplaud
docker compose build
docker compose up -d
```
- **TODO**: Run `bun run build` and fix any TypeScript errors before merging

---

## Provider Configuration Guide

### Adding providers via OpenPlaud UI (Settings → AI Providers)

The `provider` field in `api_credentials` controls which implementation is used via `inferProviderType()`:

| Provider name contains | `baseUrl` | Inferred type | Class used |
|------------------------|-----------|---------------|------------|
| `azure` | any | `azure` | `AzureTranscriptionProvider` |
| `litellm` | any | `litellm` | `LiteLLMTranscriptionProvider` |
| anything | non-openai URL | `local` | `OpenAITranscriptionProvider` |
| anything | openai URL or blank | `openai` | `OpenAITranscriptionProvider` |

#### Azure Whisper (direct)
- Provider name: `azure`
- API Key: see `~/home/home-k8s/apps/ai/ai-litellm/ai-litellm-conf.env` (straker-ai-eu-product-02 key)
- Base URL: `https://REDACTED_AZURE_ENDPOINT/openai/deployments/whisper`
- Model: `whisper`

#### Azure Whisper via LiteLLM (recommended — routes through proxy)
- Provider name: `litellm`
- API Key: see cluster secrets (`REDACTED_API_KEY`)
- Base URL: `http://REDACTED_INTERNAL_IP/v1`
- Model: `whisper-1`

#### Gemini via LiteLLM
- Provider name: `litellm`
- API Key: see cluster secrets (`REDACTED_API_KEY`)
- Base URL: `http://REDACTED_INTERNAL_IP/v1`
- Model: `gemini-3-flash-lb`

#### Local Speaches
- Provider name: `local` or `speaches`
- API Key: `not-needed`
- Base URL: `http://openplaud-whisper:8000/v1` (Docker internal) or `http://localhost:8300/v1`
- Model: `Systran/faster-whisper-small`

---

## Obsidian Integration Setup

Requires the **Obsidian Local REST API** community plugin (https://github.com/coddingtonbear/obsidian-local-rest-api).

1. Install plugin in Obsidian → Community Plugins → search "Local REST API"
2. Enable HTTPS in plugin settings (runs on port 27124 by default)
3. Copy the API key from plugin settings
4. In OpenPlaud Settings → Obsidian:
   - API URL: `https://127.0.0.1:27124` (if OpenPlaud runs on same machine as Obsidian)
   - API Key: (from plugin)
   - Vault Path: `Transcriptions/Plaud` (folder within your vault)
   - Auto-export: toggle on to export after every transcription

**Note**: If OpenPlaud runs on K8s cluster, Obsidian REST API would need to be reachable (Tailscale, reverse proxy, etc.). For local Docker setup it works out of the box.

---

## Known Issues / Technical Debt

| Issue | Status | Notes |
|-------|--------|-------|
| Plaud APAC connection requires manual DB insert | Workaround in place | Fixed in fork via servers.ts — needs UI work |
| Plaud audio stored as Opus with .mp3 extension | Fixed in fork | `detectAudioFormat()` handles this |
| Azure Whisper rejected Opus files | Fixed in fork | `AzureTranscriptionProvider` passes correct extension |
| OpenPlaud has no recording delete endpoint | Not fixed | `isTrash` field exists in schema but no API route |
| Auto-title generation uses Whisper model for chat | Fixed in generate-title.ts upstream | Falls back to gpt-4o-mini |
| Exporter session token expires | Not fixed | Manual re-grab from browser cookies needed |
| LiteLLM whisper-local points to Mac IP | Fragile | Mac travels, IP changes. Only reliable on home network |

---

## How to Resume Work

```bash
# 1. Navigate to fork
cd ~/home/openplaud

# 2. Check branch
git status
git branch

# 3. Pull latest from upstream (get upstream fixes)
git fetch upstream && git merge upstream/main

# 4. Install deps (if needed)
bun install

# 5. Verify build
bun run build

# 6. Next TODO: generate DB migration for obsidian_config column
bun run db:generate
# Then review generated migration in src/db/migrations/
bun run db:migrate  # for local dev
```

---

## Files Changed vs Upstream

```
src/lib/plaud/servers.ts                              ← APAC server added
src/lib/audio/detect-format.ts                        ← NEW: magic byte detection
src/lib/transcription/providers/types.ts              ← NEW
src/lib/transcription/providers/openai-provider.ts    ← NEW
src/lib/transcription/providers/azure-provider.ts     ← NEW
src/lib/transcription/providers/litellm-provider.ts   ← NEW
src/lib/transcription/providers/factory.ts            ← NEW
src/lib/transcription/providers/index.ts              ← NEW
src/lib/transcription/transcribe-recording.ts         ← Updated (uses providers)
src/lib/obsidian/client.ts                            ← NEW
src/lib/obsidian/formatter.ts                         ← NEW
src/lib/obsidian/index.ts                             ← NEW
src/app/api/recordings/[id]/rename/route.ts           ← NEW
src/app/api/recordings/[id]/export-obsidian/route.ts  ← NEW
src/app/api/recordings/[id]/enhance/route.ts          ← NEW
src/app/api/recordings/[id]/route.ts                  ← Updated (returns enhancement)
src/db/schema.ts                                      ← obsidianConfig column added
docs/FORK_STATE.md                                    ← NEW (this file)
```
