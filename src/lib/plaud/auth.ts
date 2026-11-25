import { PLAUD_USER_AGENT } from "./servers";

export interface PlaudRefreshTokenFields {
    access_token?: string;
    refresh_token?: string;
    ut_expire_at?: number;
    urt_expire_at?: number;
}

export interface PlaudRefreshUserTokenResponse extends PlaudRefreshTokenFields {
    status?: number;
    msg?: string;
    data?: PlaudRefreshTokenFields;
}

/**
 * A Plaud user token (UT) with its optional refresh token and expiries.
 * `sessionExpiresAt` is when the sign-in ends for good: refreshing never
 * extends past it.
 */
export interface PlaudTokenSet {
    accessToken: string;
    refreshToken: string | null;
    accessExpiresAt: Date | null;
    sessionExpiresAt: Date | null;
}

const REFRESH_REJECTED_MESSAGE =
    "Plaud ended this sign-in. Reconnect your Plaud account with a fresh token.";

function unixSecondsToDate(value: unknown): Date | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    return new Date(value * 1000);
}

/** Read the `exp` claim (unix seconds) off a Plaud JWT, if decodable. */
export function decodeAccessTokenExpiry(token: string): Date | null {
    const exp = decodeJwtClaims(token)?.exp;
    return exp === undefined ? null : unixSecondsToDate(exp);
}

/** Decode a JWT payload's claims, or null when the token isn't a JWT. */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
    const payload = token.split(".")[1];
    if (!payload) return null;
    try {
        const claims = JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8"),
        );
        return typeof claims === "object" && claims !== null
            ? (claims as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/**
 * True for Plaud workspace tokens (WT). The web app uses a short-lived WT on
 * data requests (its JWT header is `typ: "WT"`, claims carry `wtype`); it
 * validates against `/device/list` but cannot be refreshed, so a pasted WT
 * silently kills the connection within a day.
 */
export function isPlaudWorkspaceToken(token: string): boolean {
    const header = token.split(".")[0];
    try {
        const { typ } = JSON.parse(
            Buffer.from(header, "base64url").toString("utf8"),
        ) as { typ?: unknown };
        if (typ === "WT") return true;
    } catch {
        // not a decodable header; fall through to claims
    }
    const claims = decodeJwtClaims(token);
    return Boolean(claims && claims.wtype !== undefined);
}

/**
 * Build a token set, preferring Plaud's explicit `ut_expire_at` /
 * `urt_expire_at` (unix seconds) and falling back to each JWT's `exp`.
 * Without a refresh token the session ends when the access token does.
 */
export function buildPlaudTokenSet(input: {
    accessToken: string;
    refreshToken?: string | null;
    accessExpireAt?: unknown;
    refreshExpireAt?: unknown;
}): PlaudTokenSet {
    const refreshToken = input.refreshToken || null;
    const accessExpiresAt =
        unixSecondsToDate(input.accessExpireAt) ??
        decodeAccessTokenExpiry(input.accessToken);
    const sessionExpiresAt = refreshToken
        ? (unixSecondsToDate(input.refreshExpireAt) ??
          decodeAccessTokenExpiry(refreshToken))
        : accessExpiresAt;
    return {
        accessToken: input.accessToken,
        refreshToken,
        accessExpiresAt,
        sessionExpiresAt,
    };
}

function tokenSetFromBody(
    body: PlaudRefreshUserTokenResponse,
    fallbackRefreshToken: string | null,
): PlaudTokenSet | null {
    const accessToken = body.access_token ?? body.data?.access_token;
    if (!accessToken) return null;
    return buildPlaudTokenSet({
        accessToken,
        refreshToken:
            body.refresh_token ??
            body.data?.refresh_token ??
            fallbackRefreshToken,
        accessExpireAt: body.ut_expire_at ?? body.data?.ut_expire_at,
        refreshExpireAt: body.urt_expire_at ?? body.data?.urt_expire_at,
    });
}

/** Thrown when Plaud rejected the refresh token: the sign-in has ended. */
export class PlaudRefreshRejectedError extends Error {
    constructor(message = REFRESH_REJECTED_MESSAGE) {
        super(message);
        this.name = "PlaudRefreshRejectedError";
    }
}

/** Thrown for transient refresh failures (rate limit, upstream, network). */
export class PlaudRefreshTransientError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PlaudRefreshTransientError";
    }
}

/**
 * Exchange a refresh token for a fresh user token
 * (`POST /auth/refresh-user-token`). Plaud rotates the refresh token but
 * keeps the old one valid, and never extends the session past its original
 * end. Throws `PlaudRefreshRejectedError` when Plaud rejects the refresh
 * token, `PlaudRefreshTransientError` for transient failures (including
 * network errors).
 */
export async function plaudRefreshUserToken(
    refreshToken: string,
    apiBase: string,
): Promise<PlaudTokenSet> {
    let res: Response;
    try {
        res = await fetch(`${apiBase}/auth/refresh-user-token`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${refreshToken}`,
                "User-Agent": PLAUD_USER_AGENT,
                Accept: "application/json, text/plain, */*",
            },
        });
    } catch {
        throw new PlaudRefreshTransientError(
            "Failed to communicate with Plaud. Please try again later.",
        );
    }

    if (res.status === 429) {
        throw new PlaudRefreshTransientError(
            "Too many requests to Plaud. Please try again later.",
        );
    }
    if (res.status >= 500) {
        throw new PlaudRefreshTransientError(
            "Plaud is temporarily unavailable. Please try again later.",
        );
    }
    if (!res.ok) {
        throw new PlaudRefreshRejectedError();
    }

    let body: PlaudRefreshUserTokenResponse;
    try {
        body = (await res.json()) as PlaudRefreshUserTokenResponse;
    } catch {
        throw new PlaudRefreshRejectedError();
    }
    const tokens =
        body.status === undefined || body.status === 0
            ? tokenSetFromBody(body, refreshToken)
            : null;
    if (!tokens) {
        throw new PlaudRefreshRejectedError();
    }
    return tokens;
}
