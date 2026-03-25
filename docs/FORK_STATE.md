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
| **LiteLLM proxy** | `http://REDACTED_INTERNAL_IP` | K8s cluster |
| **Azure Whisper** | `REDACTED_AZURE_ENDPOINT` | Deployment: `whisper`, api-version: `2024-06-01` |
| **K8s cluster** | kubeconfig: `~/home/home-k8s/kubeconfig.yaml` | RKE2, 3 nodes |
| **Obsidian REST API** | `host.docker.internal:27123` | From container; `127.0.0.1:27123` from host |

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
- **Workaround still needed** for existing local Docker DB (connection was manually inserted)

#### 2. Audio Format Detection
- **File**: `src/lib/audio/detect-format.ts`
- Detects Opus, MP3, WAV, FLAC from magic bytes
- Fixes: Plaud stores Opus audio with `.mp3` filenames; Azure Whisper was rejecting them

#### 3. Multi-Provider Transcription Abstraction
- **Files**: `src/lib/transcription/providers/` — `types.ts`, `openai-provider.ts`, `azure-provider.ts`, `litellm-provider.ts`, `google-speech-provider.ts`, `factory.ts`, `index.ts`
- `transcribe-recording.ts` uses provider abstraction with `force` option for re-transcription
- Provider type inferred from `provider` field and `baseUrl` for backward compatibility

#### 4. Gemini Multimodal Diarization
- **File**: `src/lib/transcription/providers/google-speech-provider.ts`
- Uses Gemini via Vertex AI (`@google-cloud/vertexai`) with `gemini-2.5-flash`
- Sends audio as inline multimodal data — no GCS upload, no size limits
- Auto-detects all speakers without count hints
- `ensureSpeakerBlankLines()` post-processor guarantees blank lines between speaker turns
- `maxOutputTokens` set to 65536 to prevent formatting loss on long recordings
- Auto-falls-back to non-Google provider on failure

#### 5. Speaker Name Mapping
- **File**: `src/components/dashboard/speaker-label-editor.tsx`
- **API**: `GET/PATCH /api/recordings/[id]/speaker-map`
- **Schema**: `speaker_map` JSONB column on `transcriptions` table (migration 0015)
- Detects unique `Speaker N` labels from transcription text
- UI: collapsible editor with color-coded speakers and inline name inputs
- Applied at display time in `TranscriptionPanel` and in Obsidian exports — raw text untouched

#### 6. Recording Rename with Cloud Sync
- **File**: `src/app/api/recordings/[id]/rename/route.ts`
- `PATCH` endpoint: updates local DB + syncs title back to Plaud cloud
- Pencil icon on dashboard; optimistic UI update after save

#### 7. User-Defined Multi-Tag System
- **Schema**: `recording_tags` + `recording_tag_assignments` tables (migration 0013)
- **API**: `GET/POST /api/tags`, `PATCH/DELETE /api/tags/[id]`, `GET/PUT /api/recordings/[id]/tags`
- **UI**: Tag assignment popover on recordings, filter pills in recording list, tag management in Settings → Tags
- Tags included in Obsidian export frontmatter

#### 8. Upstream Deletion Detection
- **Schema**: `upstream_deleted` boolean column on `recordings` (migration 0014)
- Sync flags recordings deleted from Plaud as `upstreamDeleted = true` (non-destructive)
- Clears flag if recording reappears upstream
- UI: "Local only" badge + manual delete button for flagged recordings
- Dashboard filters out `isTrash = true` recordings

#### 9. Recording Delete
- **File**: `src/app/api/recordings/[id]/route.ts` — `DELETE` endpoint
- Removes recording, audio file, and cascades (transcriptions, enhancements, tag assignments)

#### 10. AI Enhancements
- **File**: `src/app/api/recordings/[id]/enhance/route.ts`
- `POST` — generates summary, action items, key points via LiteLLM chat model
- Skips Google Gemini for chat (incompatible); uses `ENHANCEMENT_CHAT_MODEL` env var (default: `azure/openai-gpt-lb`)
- Title generation in `src/lib/ai/generate-title.ts` uses same provider logic

#### 11. Obsidian One-Way Push
- **Files**: `src/lib/obsidian/` — `client.ts`, `formatter.ts`, `index.ts`
- **API**: `POST /api/recordings/[id]/export-obsidian`
- **Settings**: `GET/PUT /api/settings/obsidian`, `POST /api/settings/obsidian/test`
- **UI**: "Push to Obsidian" button on dashboard; auto-push (silent) after speaker name save
- Exports: speaker names applied, recording tags in frontmatter, summary/key points/action items sections
- Docker `extra_hosts: host.docker.internal` for container-to-host connectivity

#### 12. Dashboard Centralization
- All key actions on main dashboard: rename, re-transcribe, tag, delete, speaker names, Obsidian push
- `recording-player.tsx` shows only date (no duplicate title)
- Optimistic local state updates after mutations (rename, tag, delete)

#### 13. Settings & Config
- Obsidian section (API URL, key, vault path, auto-export toggle, test connection)
- Transcription section: speaker diarization toggle, speaker count dropdown (2–10)
- Tags section: create, edit (rename/recolor), delete
- `ENHANCEMENT_CHAT_MODEL` env var for chat model selection

#### 14. Database Migrations
- `0011_obsidian_config.sql` — `obsidian_config` jsonb on `user_settings`
- `0012_speaker_diarization.sql` — diarization settings
- `0013_recording_tags.sql` — `recording_tags` + `recording_tag_assignments` tables
- `0014_upstream_deleted.sql` — `upstream_deleted` boolean on `recordings`
- `0015_speaker_map.sql` — `speaker_map` jsonb on `transcriptions`

#### 15. Tests
- `src/tests/audio-format.test.ts` — detectAudioFormat magic bytes (7 tests)
- `src/tests/provider-factory.test.ts` — createTranscriptionProvider + inferProviderType (8+ tests)

---

## Provider Configuration Guide

### Adding providers via OpenPlaud UI (Settings → AI Providers)

| Provider name contains | `baseUrl` | Inferred type | Class used |
|------------------------|-----------|---------------|------------|
| `google` or `gemini` | any | `google` | `GoogleSpeechTranscriptionProvider` |
| `azure` | any | `azure` | `AzureTranscriptionProvider` |
| `litellm` | any | `litellm` | `LiteLLMTranscriptionProvider` |
| anything | non-openai URL | `local` | `LiteLLMTranscriptionProvider` |
| anything | openai URL or blank | `openai` | `OpenAITranscriptionProvider` |

#### Azure Whisper via LiteLLM (recommended)
- Provider name: `litellm`
- Base URL: `http://REDACTED_INTERNAL_IP/v1`
- Model: `whisper-1`

#### Google / Gemini (diarization — preferred)
- Provider name: `Google Gemini`
- API Key: placeholder value (ignored; auth via service account)
- Base URL: leave blank
- Model: `gemini-2.5-flash`
- Runtime env: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_PROJECT_ID`, optional `GOOGLE_LOCATION`

#### Local Speaches
- Provider name: `local` or `speaches`
- API Key: `not-needed`
- Base URL: `http://openplaud-whisper:8000/v1` (Docker) or `http://localhost:8300/v1`
- Model: `Systran/faster-whisper-small`

---

## Obsidian Integration Setup

Requires the **Obsidian Local REST API** community plugin (https://github.com/coddingtonbear/obsidian-local-rest-api).

1. Install plugin in Obsidian → Community Plugins → search "Local REST API"
2. Copy the API key from plugin settings
3. In OpenPlaud Settings → Obsidian:
   - API URL: `http://host.docker.internal:27123/` (Docker) or `http://127.0.0.1:27123/` (native)
   - API Key: (from plugin)
   - Vault Path: e.g. `Plaud/Recordings`
4. Click "Test connection" to verify
5. Use "Push to Obsidian" button on dashboard after transcribing and naming speakers

---

## Known Issues / Technical Debt

| Issue | Status | Notes |
|-------|--------|-------|
| Plaud APAC connection requires manual DB insert | Workaround | Fixed in servers.ts — needs UI dropdown in onboarding |
| LiteLLM whisper-local points to Mac IP | Fragile | Mac travels, IP changes. Only reliable on home network |
| AI Enhance button not on dashboard | Open | Only on old recording detail page; needs dashboard integration |
| New features lack test coverage | Open | Tags, speaker map, Obsidian export, upstream deletion untested |
| Bulk Obsidian push | Not built | Currently one recording at a time |
| Obsidian export status tracking | Not built | No indicator of which recordings have been pushed |

---

## How to Resume Work

```bash
# 1. Navigate to fork
cd ~/home/openplaud

# 2. Check branch
git status && git branch

# 3. Pull latest from upstream
git fetch upstream && git merge upstream/main

# 4. Install deps
bun install

# 5. Verify build
bun run build

# 6. Start local stack
cd ~/home/docker-personal/openplaud
docker compose up -d --build app
```

---

## Files Changed vs Upstream

```
src/lib/plaud/servers.ts                              ← APAC server
src/lib/audio/detect-format.ts                        ← Magic byte detection
src/lib/transcription/providers/types.ts              ← Provider interface
src/lib/transcription/providers/openai-provider.ts    ← OpenAI SDK
src/lib/transcription/providers/azure-provider.ts     ← Azure Whisper
src/lib/transcription/providers/litellm-provider.ts   ← LiteLLM proxy
src/lib/transcription/providers/google-speech-provider.ts ← Gemini diarization
src/lib/transcription/providers/factory.ts            ← Provider factory + inference
src/lib/transcription/providers/index.ts              ← Barrel export
src/lib/transcription/transcribe-recording.ts         ← Provider abstraction + force re-transcribe
src/lib/obsidian/client.ts                            ← Obsidian REST client
src/lib/obsidian/formatter.ts                         ← Markdown + YAML formatter
src/lib/obsidian/index.ts                             ← Barrel export
src/lib/ai/generate-title.ts                          ← LiteLLM-aware title gen
src/lib/sync/sync-recordings.ts                       ← Upstream deletion detection
src/app/api/recordings/[id]/rename/route.ts           ← Rename + Plaud sync
src/app/api/recordings/[id]/export-obsidian/route.ts  ← Obsidian push
src/app/api/recordings/[id]/enhance/route.ts          ← AI enhancements
src/app/api/recordings/[id]/transcribe/route.ts       ← Force re-transcribe
src/app/api/recordings/[id]/speaker-map/route.ts      ← Speaker name mapping
src/app/api/recordings/[id]/tags/route.ts             ← Tag assignments
src/app/api/recordings/[id]/route.ts                  ← GET + DELETE recording
src/app/api/tags/route.ts                             ← Tag CRUD
src/app/api/tags/[id]/route.ts                        ← Tag edit/delete
src/app/api/plaud/sync/route.ts                       ← Returns removedRecordings count
src/app/api/settings/obsidian/route.ts                ← Obsidian config
src/app/api/settings/obsidian/test/route.ts           ← Connection test
src/app/(app)/dashboard/page.tsx                      ← Tags, speakerMap, upstream filtering
src/components/dashboard/workstation.tsx              ← Centralized dashboard actions
src/components/dashboard/transcription-panel.tsx      ← Speaker map display + editor
src/components/dashboard/speaker-label-editor.tsx     ← Speaker name UI
src/components/dashboard/recording-player.tsx         ← Removed duplicate title
src/components/dashboard/recording-list.tsx           ← Tags, filters, local-only badge
src/components/dashboard/tag-assignment.tsx           ← Tag popover
src/components/settings-dialog.tsx                    ← Tags section
src/components/settings-content.tsx                   ← Tags routing
src/components/settings-sections/tags-section.tsx     ← Tag management UI
src/components/settings-sections/transcription-section.tsx ← Diarization settings
src/components/settings/add-provider-dialog.tsx       ← Google Gemini preset
src/components/settings/edit-provider-dialog.tsx      ← Google Gemini normalization
src/components/recordings/recording-workstation.tsx   ← Visible rename button
src/components/recordings/transcription-section.tsx   ← Force re-transcribe
src/db/schema.ts                                      ← Tags, speakerMap, upstreamDeleted
src/db/migrations/0011–0015                           ← 5 new migrations
src/types/recording.ts                                ← Tag + upstreamDeleted types
src/types/settings.ts                                 ← Tags section type
src/tests/provider-factory.test.ts                    ← Google/Gemini inference tests
docs/FORK_STATE.md                                    ← This file
docs/changelog.md                                     ← Full change history
```
