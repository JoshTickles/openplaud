import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { litellmCooldown } from "@/lib/transcription/backend-failover";

const generateContentStream = vi.fn();

vi.mock("@google/genai", () => ({
    GoogleGenAI: class {
        models = { generateContentStream };
    },
}));

/** Minimal Vertex stream: one chunk of diarized, timestamped text. */
function vertexStream(text = "[0:01] Speaker 1: from vertex") {
    return Promise.resolve({
        async *[Symbol.asyncIterator]() {
            yield { text };
        },
    });
}

function litellmResponse(status: number, body: string) {
    return Promise.resolve(
        new Response(body, { status, headers: { "Content-Type": "application/json" } }),
    );
}

const BUDGET_429 =
    '{"error":{"message":"Budget has been exceeded! Key=josh-angel Current cost: 903.06, Max budget: 900.0"}}';

async function newProvider() {
    // Imported lazily so the constructor reads the env set by each test.
    const { GoogleSpeechTranscriptionProvider } = await import(
        "@/lib/transcription/providers/google-speech-provider"
    );
    return new GoogleSpeechTranscriptionProvider("unused-key");
}

const AUDIO = Buffer.from("ID3fake-mp3-bytes");
const OPTIONS = { model: "gemini-3-flash-preview", responseFormat: "diarized_json" };

describe("LiteLLM -> Vertex transcription failover", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        litellmCooldown.clear();
        generateContentStream.mockReset();
        generateContentStream.mockImplementation(() => vertexStream());
        process.env.TRANSCRIPTION_BACKEND = "litellm";
        process.env.LITELLM_TRANSCRIBE_BASE_URL = "https://proxy.test/v1";
        process.env.LITELLM_TRANSCRIBE_API_KEY = "test-key";
        process.env.LITELLM_TRANSCRIBE_MODEL = "litellm/gemini-flash";
        process.env.GOOGLE_PROJECT_ID = "test-project";
        fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
        fetchSpy.mockRestore();
        litellmCooldown.clear();
    });

    it("uses LiteLLM and never touches Vertex while the proxy is healthy", async () => {
        fetchSpy.mockReturnValue(
            litellmResponse(
                200,
                JSON.stringify({
                    choices: [{ message: { content: "[0:01] Speaker 1: from litellm" } }],
                }),
            ),
        );

        const result = await (await newProvider()).transcribe(AUDIO, "a.mp3", OPTIONS);

        expect(result.backendUsed).toBe("litellm");
        expect(result.modelUsed).toBe("litellm/gemini-flash");
        expect(result.failoverNotice).toBeUndefined();
        expect(result.text).toContain("from litellm");
        expect(generateContentStream).not.toHaveBeenCalled();
    });

    it("falls over to Vertex on a budget 429 and says so", async () => {
        fetchSpy.mockReturnValue(litellmResponse(429, BUDGET_429));

        const result = await (await newProvider()).transcribe(AUDIO, "a.mp3", OPTIONS);

        expect(result.backendUsed).toBe("vertex-failover");
        expect(result.modelUsed).toBe("gemini-3-flash-preview");
        expect(result.text).toContain("from vertex");
        expect(result.failoverNotice).toMatch(/budget is exhausted/);
        expect(generateContentStream).toHaveBeenCalledTimes(1);
    });

    it("skips the proxy entirely on the next run while the cooldown holds", async () => {
        fetchSpy.mockReturnValue(litellmResponse(429, BUDGET_429));
        const provider = await newProvider();
        await provider.transcribe(AUDIO, "a.mp3", OPTIONS);
        fetchSpy.mockClear();

        const second = await provider.transcribe(AUDIO, "a.mp3", OPTIONS);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(second.backendUsed).toBe("vertex-failover");
        expect(second.failoverNotice).toMatch(/cooldown/);
    });

    it("returns to LiteLLM once the cooldown has expired", async () => {
        fetchSpy.mockReturnValue(litellmResponse(429, BUDGET_429));
        const provider = await newProvider();
        await provider.transcribe(AUDIO, "a.mp3", OPTIONS);

        litellmCooldown.clear(); // stands in for the window elapsing
        fetchSpy.mockReturnValue(
            litellmResponse(
                200,
                JSON.stringify({ choices: [{ message: { content: "Speaker 1: back" } }] }),
            ),
        );

        const result = await provider.transcribe(AUDIO, "a.mp3", OPTIONS);
        expect(result.backendUsed).toBe("litellm");
        expect(result.failoverNotice).toBeUndefined();
    });

    it("surfaces a fatal proxy error instead of masking it with Vertex", async () => {
        fetchSpy.mockReturnValue(litellmResponse(401, '{"error":"invalid api key"}'));

        await expect(
            (await newProvider()).transcribe(AUDIO, "a.mp3", OPTIONS),
        ).rejects.toThrow(/401/);
        expect(generateContentStream).not.toHaveBeenCalled();
    });

    it("does not attempt failover when Vertex credentials are absent", async () => {
        process.env.GOOGLE_PROJECT_ID = "";
        fetchSpy.mockReturnValue(litellmResponse(429, BUDGET_429));

        await expect(
            (await newProvider()).transcribe(AUDIO, "a.mp3", OPTIONS),
        ).rejects.toThrow(/429/);
        expect(generateContentStream).not.toHaveBeenCalled();
    });
});
