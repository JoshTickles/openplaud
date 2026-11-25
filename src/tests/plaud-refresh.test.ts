import { afterEach, describe, expect, it, vi } from "vitest";
import {
    buildPlaudTokenSet,
    decodeAccessTokenExpiry,
    decodeJwtClaims,
    isPlaudWorkspaceToken,
    PlaudRefreshRejectedError,
    PlaudRefreshTransientError,
    plaudRefreshUserToken,
} from "@/lib/plaud/auth";
import { PlaudClient } from "@/lib/plaud/client";

const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

function makeJwt(
    claims: Record<string, unknown>,
    header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): string {
    return `${b64url(header)}.${b64url(claims)}.sig`;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("decodeJwtClaims", () => {
    it("decodes a JWT payload", () => {
        const token = makeJwt({ sub: "u1", exp: 1_800_000_000 });
        expect(decodeJwtClaims(token)).toMatchObject({ sub: "u1" });
    });

    it("returns null for non-JWT strings and bad payloads", () => {
        expect(decodeJwtClaims("not-a-jwt")).toBeNull();
        expect(decodeJwtClaims("aaa.!!!.bbb")).toBeNull();
    });
});

describe("decodeAccessTokenExpiry", () => {
    it("reads the exp claim", () => {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const token = makeJwt({ exp });
        const expiry = decodeAccessTokenExpiry(token);
        expect(expiry?.getTime()).toBe(exp * 1000);
    });

    it("returns null when there is no exp", () => {
        expect(decodeAccessTokenExpiry(makeJwt({ sub: "u1" }))).toBeNull();
    });
});

describe("isPlaudWorkspaceToken", () => {
    it("detects workspace tokens by header typ", () => {
        const wt = makeJwt({ sub: "u1" }, { alg: "HS256", typ: "WT" });
        expect(isPlaudWorkspaceToken(wt)).toBe(true);
    });

    it("detects workspace tokens by the wtype claim", () => {
        expect(isPlaudWorkspaceToken(makeJwt({ wtype: "ws" }))).toBe(true);
    });

    it("accepts plain user tokens", () => {
        expect(isPlaudWorkspaceToken(makeJwt({ sub: "u1" }))).toBe(false);
        expect(isPlaudWorkspaceToken("garbage")).toBe(false);
    });
});

describe("plaudRefreshUserToken", () => {
    const refreshToken = makeJwt({ sub: "u1" });

    it("posts the refresh shape and parses the token set", async () => {
        const access = makeJwt({ sub: "u1", exp: 1_800_000_001 });
        const refresh = makeJwt({ sub: "u1", exp: 1_800_000_002 });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                status: 0,
                access_token: access,
                refresh_token: refresh,
                ut_expire_at: 1_800_000_001,
                urt_expire_at: 1_800_000_002,
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await plaudRefreshUserToken(
            refreshToken,
            "https://api.plaud.ai",
        );

        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.plaud.ai/auth/refresh-user-token",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: `Bearer ${refreshToken}`,
                }),
            }),
        );
        expect(result.accessToken).toBe(access);
        expect(result.refreshToken).toBe(refresh);
        expect(result.accessExpiresAt?.getTime()).toBe(1_800_000_001 * 1000);
        expect(result.sessionExpiresAt?.getTime()).toBe(1_800_000_002 * 1000);
    });

    it("parses tokens nested under data", async () => {
        const access = makeJwt({ sub: "u1", exp: 1_800_000_001 });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ status: 0, data: { access_token: access } }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await plaudRefreshUserToken(
            refreshToken,
            "https://api.plaud.ai",
        );
        expect(result.accessToken).toBe(access);
        // No rotated refresh token: the stored one is kept.
        expect(result.refreshToken).toBe(refreshToken);
    });

    it("rejects when Plaud refuses the refresh token", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                json: async () => {
                    throw new Error("no body");
                },
            }),
        );
        await expect(
            plaudRefreshUserToken(refreshToken, "https://api.plaud.ai"),
        ).rejects.toThrow(PlaudRefreshRejectedError);
    });

    it("treats rate limits and upstream errors as transient", async () => {
        for (const status of [429, 502]) {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({ ok: false, status }),
            );
            await expect(
                plaudRefreshUserToken(refreshToken, "https://api.plaud.ai"),
            ).rejects.toThrow(PlaudRefreshTransientError);
        }
    });

    it("treats network failures as transient", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockRejectedValue(new Error("network down")),
        );
        await expect(
            plaudRefreshUserToken(refreshToken, "https://api.plaud.ai"),
        ).rejects.toThrow(PlaudRefreshTransientError);
    });

    it("rejects a body without an access token", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ status: 0 }),
            }),
        );
        await expect(
            plaudRefreshUserToken(refreshToken, "https://api.plaud.ai"),
        ).rejects.toThrow(PlaudRefreshRejectedError);
    });
});

describe("PlaudClient 401 refresh", () => {
    it("refreshes once and replays the request on a 401", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 401,
                headers: new Headers(),
                json: async () => ({ msg: "expired" }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers(),
                json: async () => ({ status: 0, data: [] }),
            });
        vi.stubGlobal("fetch", fetchMock);

        const refreshUserToken = vi.fn().mockResolvedValue("fresh-token");
        const client = new PlaudClient("stale-token", "https://api.plaud.ai", {
            refreshUserToken,
        });
        await expect(client.listDevices()).resolves.toBeTruthy();

        expect(refreshUserToken).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const replayHeaders = fetchMock.mock.calls[1][1].headers;
        expect(replayHeaders.Authorization).toBe("Bearer fresh-token");
    });

    it("surfaces the refresh rejection when the sign-in ended", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                headers: new Headers(),
                json: async () => ({ msg: "expired" }),
            }),
        );
        const client = new PlaudClient("stale", "https://api.plaud.ai", {
            refreshUserToken: vi
                .fn()
                .mockRejectedValue(new PlaudRefreshRejectedError()),
        });
        await expect(client.listDevices()).rejects.toThrow(
            PlaudRefreshRejectedError,
        );
    });

    it("leaves 401s alone when the connection has no refresh token", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                headers: new Headers(),
                json: async () => ({ msg: "expired" }),
            }),
        );
        const client = new PlaudClient("stale", "https://api.plaud.ai");
        await expect(client.listDevices()).rejects.toThrow("401");
    });
});

describe("buildPlaudTokenSet", () => {
    it("falls back to JWT expiries", () => {
        const accessExp = Math.floor(Date.now() / 1000) + 86_400;
        const refreshExp = Math.floor(Date.now() / 1000) + 30 * 86_400;
        const access = makeJwt({ exp: accessExp });
        const refresh = makeJwt({ exp: refreshExp });
        const tokens = buildPlaudTokenSet({
            accessToken: access,
            refreshToken: refresh,
        });
        expect(tokens.accessExpiresAt?.getTime()).toBe(accessExp * 1000);
        expect(tokens.sessionExpiresAt?.getTime()).toBe(refreshExp * 1000);
    });

    it("prefers explicit ut_expire_at / urt_expire_at", () => {
        const access = makeJwt({ exp: 1 });
        const refresh = makeJwt({ exp: 2 });
        const tokens = buildPlaudTokenSet({
            accessToken: access,
            refreshToken: refresh,
            accessExpireAt: 1_800_000_001,
            refreshExpireAt: 1_800_000_002,
        });
        expect(tokens.accessExpiresAt?.getTime()).toBe(1_800_000_001 * 1000);
        expect(tokens.sessionExpiresAt?.getTime()).toBe(1_800_000_002 * 1000);
    });

    it("without a refresh token the session ends with the access token", () => {
        const exp = Math.floor(Date.now() / 1000) + 86_400;
        const tokens = buildPlaudTokenSet({ accessToken: makeJwt({ exp }) });
        expect(tokens.accessExpiresAt?.getTime()).toBe(exp * 1000);
        expect(tokens.sessionExpiresAt?.getTime()).toBe(exp * 1000);
        expect(tokens.refreshToken).toBeNull();
    });
});
