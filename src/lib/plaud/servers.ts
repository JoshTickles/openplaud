export const PLAUD_SERVERS = {
    global: { label: "Global (api.plaud.ai)", apiBase: "https://api.plaud.ai" },
    eu: { label: "EU – Frankfurt (api-euc1.plaud.ai)", apiBase: "https://api-euc1.plaud.ai" },
} as const;

export type PlaudServerKey = keyof typeof PLAUD_SERVERS;
export const DEFAULT_SERVER_KEY: PlaudServerKey = "global";
