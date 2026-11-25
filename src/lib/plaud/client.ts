import { gunzipSync } from "node:zlib";
import type {
    PlaudApiError,
    PlaudContentSegment,
    PlaudDeviceListResponse,
    PlaudFileDetailResponse,
    PlaudFileListResponse,
    PlaudRecording,
    PlaudRecordingsResponse,
    PlaudTempUrlResponse,
    PlaudV4ContentUrlResponse,
    PlaudV4FileDetailResponse,
    PlaudV4FolderChildrenResponse,
    PlaudV4Node,
    PlaudV4RecordingsResponse,
    PlaudV4RenameResponse,
} from "@/types/plaud";
import { parseTranscript } from "./content";
import { DEFAULT_SERVER_KEY, PLAUD_SERVERS } from "./servers";
import {
    applyPlaudV4Detail,
    isPlaudV4MigratedResponse,
    mapPlaudV4Item,
    PLAUD_V4_VERSION_CONFLICT_STATUS,
    plaudV4AudioCandidates,
    plaudV4DetailToLegacy,
    recordingIdToPlaudV4FileId,
    sortPlaudRecordings,
} from "./v4";

export interface PlaudUpdateFilenameResponse {
    status: number;
    msg: string;
    data_file?: unknown;
}

export const DEFAULT_PLAUD_API_BASE = PLAUD_SERVERS[DEFAULT_SERVER_KEY].apiBase;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const V4_PAGE_SIZE = 50;
const V4_MAX_PAGES = 400;

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TranscriptTurnSource {
    speaker?: string | number;
    content?: string;
}

/**
 * Convert transcript segments to "Speaker N: text" blocks with blank lines
 * between turns. Consecutive segments from the same speaker merge into one
 * turn. If Plaud labels speakers "SPEAKER_00" style, they map to "Speaker 1".
 */
function formatTranscriptTurns(
    segments: TranscriptTurnSource[],
): string | null {
    const turns: { speaker: string; text: string }[] = [];
    for (const seg of segments) {
        const content = (seg.content ?? "").trim();
        if (!content) continue;
        const speaker = seg.speaker == null ? "" : String(seg.speaker);
        const last = turns[turns.length - 1];
        if (last && last.speaker === speaker) {
            last.text += ` ${content}`;
        } else {
            turns.push({ speaker, text: content });
        }
    }
    if (turns.length === 0) return null;

    const speakerOrder: string[] = [];
    for (const { speaker } of turns) {
        if (!speakerOrder.includes(speaker)) speakerOrder.push(speaker);
    }
    const isRaw = speakerOrder.some((s) => /^SPEAKER_\d+$/.test(s));
    const labelFor = (s: string) =>
        isRaw ? `Speaker ${speakerOrder.indexOf(s) + 1}` : s;

    return turns
        .map(({ speaker, text }) => `${labelFor(speaker)}: ${text}`)
        .join("\n\n");
}

/**
 * Plaud API Client
 * Handles all communication with Plaud API
 *
 * Accounts migrated to Plaud 4.0 reject every legacy `/file/...` endpoint
 * with status -1800907. On the first such reply the client switches to the
 * `/file-app/v4/...` API for the rest of its lifetime.
 */
export class PlaudClient {
    private bearerToken: string;
    private apiBase: string;
    private v4Mode = false;
    private v4ListCache?: PlaudRecording[];
    private readonly v4DetailCache = new Map<
        string,
        NonNullable<PlaudV4FileDetailResponse["data"]>
    >();

    constructor(bearerToken: string, apiBase: string = DEFAULT_PLAUD_API_BASE) {
        this.bearerToken = bearerToken;
        this.apiBase = apiBase;
    }

    /**
     * Make authenticated request to Plaud API with retry logic
     */
    private async request<T>(
        endpoint: string,
        options?: RequestInit,
        retryCount = 0,
    ): Promise<T> {
        const url = `${this.apiBase}${endpoint}`;

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...options?.headers,
                    Authorization: `Bearer ${this.bearerToken}`,
                    "Content-Type": "application/json",
                    "User-Agent": USER_AGENT,
                    Accept: "application/json, text/plain, */*",
                },
            });

            if (response.status === 429 && retryCount < MAX_RETRIES) {
                const retryAfter = response.headers.get("Retry-After");
                const delay = retryAfter
                    ? Number.parseInt(retryAfter, 10) * 1000
                    : INITIAL_RETRY_DELAY * 2 ** retryCount; // Exponential backoff
                await sleep(delay);
                return this.request<T>(endpoint, options, retryCount + 1);
            }

            if (!response.ok) {
                const error = (await response.json()) as PlaudApiError;
                const errorMessage = `Plaud API error (${response.status}): ${error.msg || response.statusText}`;

                if (
                    response.status >= 500 &&
                    response.status < 600 &&
                    retryCount < MAX_RETRIES
                ) {
                    const delay = INITIAL_RETRY_DELAY * 2 ** retryCount;
                    await sleep(delay);
                    return this.request<T>(endpoint, options, retryCount + 1);
                }

                throw new Error(errorMessage);
            }

            return (await response.json()) as T;
        } catch (error) {
            if (
                error instanceof TypeError &&
                error.message.includes("fetch") &&
                retryCount < MAX_RETRIES
            ) {
                const delay = INITIAL_RETRY_DELAY * 2 ** retryCount;
                await sleep(delay);
                return this.request<T>(endpoint, options, retryCount + 1);
            }

            if (error instanceof Error) {
                throw error;
            }
            throw new Error(
                `Failed to make request to Plaud API: ${String(error)}`,
            );
        }
    }

    /**
     * List all devices associated with the account
     */
    async listDevices(): Promise<PlaudDeviceListResponse> {
        return this.request<PlaudDeviceListResponse>("/device/list");
    }

    /**
     * Get all recordings
     * @param skip - Number of recordings to skip
     * @param limit - Maximum number of recordings to return
     * @param isTrash - Whether to get trashed recordings (0 = active, 1 = trash)
     * @param sortBy - Field to sort by (default: edit_time)
     * @param isDesc - Sort in descending order (default: true)
     *
     * A migrated (Plaud 4.0) account gets the legacy reply rejected with
     * status -1800907; the client then serves the listing from
     * `/file-app/v4/recordings/all`, mapped onto the legacy shape.
     */
    async getRecordings(
        skip: number = 0,
        limit: number = 99999,
        isTrash: number = 0,
        sortBy: string = "edit_time",
        isDesc: boolean = true,
    ): Promise<PlaudRecordingsResponse> {
        if (!this.v4Mode) {
            const params = new URLSearchParams({
                skip: skip.toString(),
                limit: limit.toString(),
                is_trash: isTrash.toString(),
                sort_by: sortBy,
                is_desc: isDesc.toString(),
            });

            const body = await this.request<PlaudRecordingsResponse>(
                `/file/simple/web?${params.toString()}`,
            );
            if (Array.isArray(body?.data_file_list)) return body;
            if (!isPlaudV4MigratedResponse(body)) {
                throw new Error(
                    `Plaud API error: ${body?.msg || "invalid recordings list response"} (status ${body?.status})`,
                );
            }
            this.v4Mode = true;
            console.warn(
                "[Plaud] account migrated to Plaud 4.0, switching to the v4 file API",
            );
        }

        if (isTrash !== 0) {
            return {
                status: 0,
                msg: "success",
                data_file_total: 0,
                data_file_list: [],
            };
        }
        const all = sortPlaudRecordings(
            await this.listAllRecordingsV4(),
            sortBy,
            isDesc,
        );
        return {
            status: 0,
            msg: "success",
            data_file_total: all.length,
            data_file_list: all.slice(skip, skip + limit),
        };
    }

    private async listAllRecordingsV4(): Promise<PlaudRecording[]> {
        if (this.v4ListCache) return this.v4ListCache;

        const out: PlaudRecording[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < V4_MAX_PAGES; page++) {
            const params = new URLSearchParams({
                sort_by: "created",
                sort_order: "desc",
                page_size: V4_PAGE_SIZE.toString(),
            });
            if (cursor) params.set("cursor", cursor);

            const body = await this.request<PlaudV4RecordingsResponse>(
                `/file-app/v4/recordings/all?${params.toString()}`,
            );
            if (body?.status !== 0 || !Array.isArray(body.data?.items)) {
                throw new Error(
                    `Plaud API error: ${body?.msg || "invalid v4 recordings response"} (status ${body?.status})`,
                );
            }
            for (const item of body.data.items) {
                if (item?.file_id) out.push(mapPlaudV4Item(item));
            }
            const next = body.data.next_cursor;
            if (!next || body.data.items.length === 0) break;
            cursor = next;
        }

        this.v4ListCache = out;
        return out;
    }

    private async getFileDetailV4(
        recordingId: string,
        { fresh = false }: { fresh?: boolean } = {},
    ): Promise<NonNullable<PlaudV4FileDetailResponse["data"]>> {
        const fileId = recordingIdToPlaudV4FileId(recordingId);
        const cached = this.v4DetailCache.get(fileId);
        if (cached && !fresh) return cached;

        const body = await this.request<PlaudV4FileDetailResponse>(
            `/file-app/v4/files/detail/${encodeURIComponent(fileId)}`,
        );
        if (body?.status !== 0 || !body.data) {
            throw new Error(
                `Plaud API error: ${body?.msg || "invalid v4 file detail"} (status ${body?.status})`,
            );
        }
        this.v4DetailCache.set(fileId, body.data);
        return body.data;
    }

    /**
     * Complete a recording listed through the v4 API (device serial, size,
     * timezone) from its v4 detail. No-op for legacy listings, so callers
     * can invoke it unconditionally before downloading.
     */
    async hydrateRecording(recording: PlaudRecording): Promise<PlaudRecording> {
        if (recording.source !== "v4") return recording;
        const detail = await this.getFileDetailV4(recording.id);
        return applyPlaudV4Detail(recording, detail);
    }

    private async getAudioUrlV4(recordingId: string): Promise<string> {
        const detail = await this.getFileDetailV4(recordingId);
        for (const audio of plaudV4AudioCandidates(detail)) {
            if (audio.content_url) return audio.content_url;
            if (!audio.content_id) continue;
            const urls = await this.resolveContentUrlsV4([audio.content_id]);
            const url = urls[audio.content_id];
            if (url) return url;
        }

        throw new Error(
            "Plaud has no downloadable audio for this recording yet.",
        );
    }

    private async resolveContentUrlsV4(
        contentIds: string[],
    ): Promise<Record<string, string>> {
        if (contentIds.length === 0) return {};
        const body = await this.request<PlaudV4ContentUrlResponse>(
            "/file-app/v4/files/content/url",
            {
                method: "POST",
                body: JSON.stringify({ content_ids: contentIds }),
            },
        );
        return body?.status === 0 ? (body.data?.url_map ?? {}) : {};
    }

    private async withContentUrlsV4(
        detail: NonNullable<PlaudV4FileDetailResponse["data"]>,
    ): Promise<NonNullable<PlaudV4FileDetailResponse["data"]>> {
        const objects = detail.objects ?? [];
        const missing = objects.flatMap((o) =>
            (o.object_type === "TRANSCRIPT" || o.object_type === "SUMMARY") &&
            !o.content_url &&
            o.content_id
                ? [o.content_id]
                : [],
        );
        if (missing.length === 0) return detail;
        const urls = await this.resolveContentUrlsV4(missing);
        return {
            ...detail,
            objects: objects.map((o) =>
                !o.content_url && o.content_id && urls[o.content_id]
                    ? { ...o, content_url: urls[o.content_id] }
                    : o,
            ),
        };
    }

    /**
     * Fetch a recording's content manifest (`/file/detail/{id}`) — lists the
     * transcript / summary items Plaud has processed and the presigned links
     * to their bodies. On Plaud 4.0 accounts a fresh v4 detail (current
     * presigned links) is mapped onto the same shape.
     */
    async getFileDetail(fileId: string): Promise<PlaudFileDetailResponse> {
        if (!this.v4Mode) {
            const body = await this.request<PlaudFileDetailResponse>(
                `/file/detail/${fileId}`,
            );
            if (!isPlaudV4MigratedResponse(body)) return body;
            this.v4Mode = true;
        }
        return plaudV4DetailToLegacy(
            await this.withContentUrlsV4(
                await this.getFileDetailV4(fileId, { fresh: true }),
            ),
        );
    }

    /**
     * Get temporary URL for downloading audio file
     * @param fileId - The recording file ID
     * @param isOpus - Whether to get OPUS format URL (default: true)
     */
    async getTempUrl(
        fileId: string,
        isOpus: boolean = true,
    ): Promise<PlaudTempUrlResponse> {
        const params = new URLSearchParams({
            is_opus: isOpus ? "1" : "0",
        });

        return this.request<PlaudTempUrlResponse>(
            `/file/temp-url/${fileId}?${params.toString()}`,
        );
    }

    /**
     * Download audio file as buffer
     * @param fileId - The recording file ID
     * @param preferOpus - Whether to prefer OPUS format (smaller size)
     */
    async downloadRecording(
        fileId: string,
        preferOpus: boolean = true,
    ): Promise<Buffer> {
        try {
            let downloadUrl: string | undefined;
            if (!this.v4Mode) {
                const tempUrlResponse = await this.getTempUrl(
                    fileId,
                    preferOpus,
                );
                if (isPlaudV4MigratedResponse(tempUrlResponse)) {
                    this.v4Mode = true;
                } else {
                    downloadUrl =
                        preferOpus && tempUrlResponse.temp_url_opus
                            ? tempUrlResponse.temp_url_opus
                            : tempUrlResponse.temp_url;
                }
            }
            if (this.v4Mode) {
                downloadUrl = await this.getAudioUrlV4(fileId);
            }
            if (!downloadUrl) {
                throw new Error(
                    "Plaud did not return a download URL for this recording.",
                );
            }

            const response = await fetch(downloadUrl);
            if (!response.ok) {
                throw new Error(
                    `Failed to download file: ${response.statusText}`,
                );
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (error) {
            throw new Error(
                `Failed to download recording: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Test connection to Plaud API
     * Returns true if bearer token is valid
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.listDevices();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Fetch stored transcript text for a recording that has been transcribed on Plaud's servers.
     * Returns formatted text ("Speaker N: text" blocks) or null if no transcript is stored.
     * @param fileId - The recording file ID
     */
    async fetchTranscript(fileId: string): Promise<string | null> {
        if (!this.v4Mode) {
            const response = await this.request<PlaudFileListResponse>(
                "/file/list",
                {
                    method: "POST",
                    body: JSON.stringify([fileId]),
                },
            );
            if (!isPlaudV4MigratedResponse(response)) {
                const file = response.data_file_list?.[0];
                if (!file?.trans_result?.length) return null;
                return formatTranscriptTurns(file.trans_result);
            }
            this.v4Mode = true;
        }

        // v4: the transcript is a TRANSCRIPT content object on the file
        // detail, pointing at a gzip-compressed segment array.
        const detail = await this.withContentUrlsV4(
            await this.getFileDetailV4(fileId),
        );
        const transcript = (detail.objects ?? []).find(
            (o) =>
                o.object_type === "TRANSCRIPT" &&
                (o.content_url || o.content_id),
        );
        if (!transcript?.content_url) return null;

        const raw = await this.fetchContentLink(transcript.content_url);
        const { segments } = parseTranscript(raw);
        if (segments.length === 0) return null;
        return formatTranscriptTurns(segments);
    }

    /**
     * Fetch a presigned content link (transcript / summary JSON) from storage.
     * Unlike Plaud API calls this carries no auth header and is gzip-aware:
     * returns parsed JSON, or the raw string when the body isn't JSON.
     */
    async fetchContentLink(url: string): Promise<unknown> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(
                `Failed to fetch Plaud content link: ${response.statusText}`,
            );
        }

        const arrayBuffer = await response.arrayBuffer();
        let buf = Buffer.from(arrayBuffer);
        if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            buf = gunzipSync(buf);
        }

        const text = buf.toString("utf-8");
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    /**
     * Update filename for a recording
     * @param fileId - The recording file ID
     * @param filename - New filename to set
     */
    async updateFilename(
        fileId: string,
        filename: string,
    ): Promise<PlaudUpdateFilenameResponse> {
        if (!this.v4Mode) {
            const body = await this.request<PlaudUpdateFilenameResponse>(
                `/file/${fileId}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({ filename }),
                },
            );
            if (!isPlaudV4MigratedResponse(body)) return body;
            this.v4Mode = true;
        }
        return this.renameV4(fileId, filename);
    }

    private async renameV4(
        recordingId: string,
        name: string,
    ): Promise<PlaudUpdateFilenameResponse> {
        let fileNode: PlaudV4Node | undefined;
        const renamed = await this.renameNodeV4(name, async () => {
            const detail = await this.getFileDetailV4(recordingId, {
                fresh: true,
            });
            fileNode = detail.node ?? undefined;
            return { nodeId: fileNode?.node_id, version: fileNode?.version_ms };
        });

        const folder = fileNode?.folder;
        const previousName = fileNode?.name;
        if (
            folder?.folder_id &&
            folder.name &&
            folder.name === previousName &&
            folder.name !== name
        ) {
            const folderId = folder.folder_id;
            const parentId = fileNode?.breadcrumbs?.[0]?.node_id;
            let fromResponse = renamed?.data?.parent_items?.find(
                (p) => p.node_id === folderId && p.name !== undefined,
            );
            try {
                await this.renameNodeV4(name, async () => {
                    const current =
                        fromResponse ??
                        (parentId
                            ? await this.findChildV4(parentId, folderId)
                            : undefined);
                    fromResponse = undefined;
                    if (!current || current.name !== previousName) {
                        return { skip: true };
                    }
                    return { nodeId: folderId, version: current.version_ms };
                });
            } catch (err) {
                console.warn(
                    "[plaud] v4 folder rename failed:",
                    err instanceof Error ? err.message : err,
                );
            }
        }

        return { status: 0, msg: "success", data_file: renamed?.data };
    }

    private async renameNodeV4(
        name: string,
        resolve: () => Promise<{
            nodeId?: string;
            version?: number;
            skip?: boolean;
        }>,
    ): Promise<PlaudV4RenameResponse | undefined> {
        let lastStatus: number | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
            const { nodeId, version, skip } = await resolve();
            if (skip) return undefined;
            if (!nodeId || version === undefined) {
                throw new Error("Plaud returned no node version to rename.");
            }
            const body = await this.request<PlaudV4RenameResponse>(
                `/file-app/v4/nodes/rename/${encodeURIComponent(nodeId)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({ name, origin_version: version }),
                },
            );
            if (body?.status === 0) return body;
            lastStatus = body?.status;
            if (body?.status !== PLAUD_V4_VERSION_CONFLICT_STATUS) {
                throw new Error(
                    `Plaud rejected the rename: ${body?.msg ?? "unknown error"} (status ${body?.status})`,
                );
            }
        }
        throw new Error(
            `Plaud rename failed: node version conflict (status ${lastStatus})`,
        );
    }

    private async findChildV4(
        parentId: string,
        childId: string,
    ): Promise<PlaudV4Node | undefined> {
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
            const params = new URLSearchParams({
                node_id: parentId,
                page_size: V4_PAGE_SIZE.toString(),
            });
            if (cursor) params.set("cursor", cursor);
            const body = await this.request<PlaudV4FolderChildrenResponse>(
                `/file-app/v4/folders/children?${params.toString()}`,
            );
            const items = body?.data?.items ?? [];
            const hit = items.find((i) => i.node_id === childId);
            if (hit) return hit;
            const next = body?.data?.next_cursor;
            if (!next || items.length === 0) return undefined;
            cursor = next;
        }
        return undefined;
    }
}

/**
 * Create Plaud client from encrypted bearer token
 */
export async function createPlaudClient(
    encryptedToken: string,
    apiBase: string = DEFAULT_PLAUD_API_BASE,
): Promise<PlaudClient> {
    const { decrypt } = await import("../encryption");
    const bearerToken = decrypt(encryptedToken);
    return new PlaudClient(bearerToken, apiBase);
}

export * from "./types";
