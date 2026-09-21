import { describe, expect, it } from "vitest";
import {
    BackendCooldown,
    COOLDOWN_MS,
    LitellmHttpError,
    canFailover,
    classifyLitellmFailure,
    describeCooldown,
    describeFailover,
} from "@/lib/transcription/backend-failover";

describe("classifyLitellmFailure", () => {
    it("separates a budget cap from an ordinary rate limit", () => {
        const budget = new LitellmHttpError(
            429,
            '{"error":{"message":"Budget has been exceeded! Key=josh-angel Current cost: 903.06, Max budget: 900.0"}}',
        );
        const rateLimit = new LitellmHttpError(
            429,
            '{"error":{"message":"Rate limit reached for model"}}',
        );
        expect(classifyLitellmFailure(budget)).toBe("budget");
        expect(classifyLitellmFailure(rateLimit)).toBe("rate_limit");
    });

    it("treats 5xx as a server failure and 4xx as fatal", () => {
        expect(classifyLitellmFailure(new LitellmHttpError(503, "upstream"))).toBe(
            "server",
        );
        expect(classifyLitellmFailure(new LitellmHttpError(401, "bad key"))).toBe(
            "fatal",
        );
        expect(
            classifyLitellmFailure(new LitellmHttpError(400, "bad request")),
        ).toBe("fatal");
    });

    it("treats transport failures as server failures", () => {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        expect(classifyLitellmFailure(abort)).toBe("server");
        expect(classifyLitellmFailure(new Error("fetch failed"))).toBe("server");
    });

    it("treats unknown errors as fatal so real bugs are not masked", () => {
        expect(classifyLitellmFailure(new TypeError("x is not a function"))).toBe(
            "fatal",
        );
        expect(classifyLitellmFailure("nope")).toBe("fatal");
    });

    it("allows failover for everything except fatal", () => {
        expect(canFailover("budget")).toBe(true);
        expect(canFailover("rate_limit")).toBe(true);
        expect(canFailover("server")).toBe(true);
        expect(canFailover("fatal")).toBe(false);
    });
});

describe("BackendCooldown", () => {
    it("stays active for the kind's window then expires", () => {
        const cd = new BackendCooldown();
        cd.trip("rate_limit", 1_000);
        expect(cd.active(1_000 + COOLDOWN_MS.rate_limit - 1)).toEqual({
            kind: "rate_limit",
            until: 1_000 + COOLDOWN_MS.rate_limit,
        });
        expect(cd.active(1_000 + COOLDOWN_MS.rate_limit)).toBeUndefined();
    });

    it("is inactive before anything trips it", () => {
        expect(new BackendCooldown().active(0)).toBeUndefined();
    });

    it("never shortens a longer cooldown already in effect", () => {
        const cd = new BackendCooldown();
        cd.trip("budget", 0);
        cd.trip("server", 1_000); // much shorter window
        expect(cd.active(1_000)?.kind).toBe("budget");
        expect(cd.active(1_000)?.until).toBe(COOLDOWN_MS.budget);
    });

    it("extends when the new cooldown reaches further", () => {
        const cd = new BackendCooldown();
        cd.trip("server", 0);
        cd.trip("budget", 0);
        expect(cd.active(0)?.kind).toBe("budget");
    });

    it("clears on demand so a success can reinstate LiteLLM", () => {
        const cd = new BackendCooldown();
        cd.trip("budget", 0);
        cd.clear();
        expect(cd.active(0)).toBeUndefined();
    });
});

describe("notices", () => {
    it("explains the reason and when LiteLLM comes back", () => {
        const state = { kind: "budget" as const, until: 10 * 60_000 };
        expect(describeFailover(state, 0)).toContain("budget is exhausted");
        expect(describeFailover(state, 0)).toContain("10 min");
        expect(describeCooldown(state, 0)).toContain("cooldown");
    });

    it("rounds up so it never says 0 min", () => {
        expect(describeFailover({ kind: "server", until: 1_000 }, 0)).toContain(
            "1 min",
        );
    });
});
