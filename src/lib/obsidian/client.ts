interface ObsidianClientConfig {
    apiUrl: string;
    apiKey: string;
}

export class ObsidianClient {
    private apiUrl: string;
    private apiKey: string;

    constructor(config: ObsidianClientConfig) {
        this.apiUrl = config.apiUrl.replace(/\/$/, "");
        this.apiKey = config.apiKey;
    }

    private async request(path: string, options: RequestInit = {}): Promise<Response> {
        const url = `${this.apiUrl}${path}`;
        return fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "text/markdown",
                ...options.headers,
            },
        });
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await this.request("/", { method: "GET", headers: { "Content-Type": "application/json" } });
            return response.ok;
        } catch {
            return false;
        }
    }

    async writeNote(vaultPath: string, content: string): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await this.request(`/vault/${encodeURIComponent(vaultPath)}`, {
                method: "PUT",
                body: content,
            });

            if (!response.ok) {
                const text = await response.text();
                return { success: false, error: `Obsidian API error (${response.status}): ${text}` };
            }

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to write to Obsidian",
            };
        }
    }
}
