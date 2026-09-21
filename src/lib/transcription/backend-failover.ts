/**
 * Decides when transcription should fall back from the LiteLLM proxy to
 * Vertex AI, and when it is safe to go back to LiteLLM.
 *
 * The proxy fails in three materially different ways and they want different
 * recovery windows: a budget cap is exhausted for a long time, a rate limit
 * clears in minutes, a 5xx is usually momentary. Everything here is pure or
 * clock-injectable so the policy can be unit-tested without network or timers.
 */

export type LitellmFailureKind = "budget" | "rate_limit" | "server" | "fatal";

/** Retryable-on-Vertex kinds. A `fatal` failure (bad key, bad request) would
 * fail the same way on any backend, so it is surfaced instead of hidden. */
export type FailoverKind = Exclude<LitellmFailureKind, "fatal">;

/** How long to stop trying LiteLLM after each kind of failure. */
export const COOLDOWN_MS: Record<FailoverKind, number> = {
    budget: 30 * 60_000,
    rate_limit: 5 * 60_000,
    server: 2 * 60_000,
};

/** Thrown by the LiteLLM call so the status/body survive for classification. */
export class LitellmHttpError extends Error {
    constructor(
        readonly status: number,
        readonly body: string,
    ) {
        super(`LiteLLM transcribe ${status}: ${body.slice(0, 400)}`);
        this.name = "LitellmHttpError";
    }
}

export function classifyLitellmFailure(error: unknown): LitellmFailureKind {
    if (error instanceof LitellmHttpError) {
        if (error.status === 429) {
            return /budget/i.test(error.body) ? "budget" : "rate_limit";
        }
        if (error.status >= 500) return "server";
        return "fatal";
    }
    // Transport-level failures (socket reset, DNS, request timeout) are worth
    // trying on the other backend; anything else is a code-level bug.
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
        name === "AbortError" ||
        name === "TimeoutError" ||
        message.includes("fetch failed") ||
        message.includes("econnreset") ||
        message.includes("socket")
    ) {
        return "server";
    }
    return "fatal";
}

export function canFailover(kind: LitellmFailureKind): kind is FailoverKind {
    return kind !== "fatal";
}

export interface CooldownState {
    kind: FailoverKind;
    until: number;
}

/**
 * Remembers that LiteLLM is unhealthy so subsequent transcriptions skip
 * straight to Vertex instead of burning another multi-minute upload on a
 * backend that is still capped. In-memory by design: a container restart is a
 * legitimate "try again now" signal.
 */
export class BackendCooldown {
    private state?: CooldownState;

    trip(kind: FailoverKind, now: number = Date.now()): CooldownState {
        const until = now + COOLDOWN_MS[kind];
        // Never shorten an existing, longer cooldown.
        if (!this.state || until > this.state.until) {
            this.state = { kind, until };
        }
        return this.state;
    }

    /** The active cooldown, or undefined once it has expired. */
    active(now: number = Date.now()): CooldownState | undefined {
        if (this.state && this.state.until > now) return this.state;
        this.state = undefined;
        return undefined;
    }

    clear(): void {
        this.state = undefined;
    }
}

/** Process-wide cooldown shared by every transcription request. */
export const litellmCooldown = new BackendCooldown();

const KIND_LABEL: Record<FailoverKind, string> = {
    budget: "its budget is exhausted",
    rate_limit: "it is rate limited",
    server: "it returned an error",
};

function minutesUntil(until: number, now: number): number {
    return Math.max(1, Math.ceil((until - now) / 60_000));
}

/** Notice shown after a live failover. */
export function describeFailover(
    state: CooldownState,
    now: number = Date.now(),
): string {
    return `Transcribed on Vertex AI: the LiteLLM proxy was skipped because ${KIND_LABEL[state.kind]}. LiteLLM will be retried in about ${minutesUntil(state.until, now)} min.`;
}

/** Notice shown when a cooldown from an earlier failure is still in effect. */
export function describeCooldown(
    state: CooldownState,
    now: number = Date.now(),
): string {
    return `Transcribed on Vertex AI: LiteLLM is in cooldown (${KIND_LABEL[state.kind]}) for about another ${minutesUntil(state.until, now)} min.`;
}
