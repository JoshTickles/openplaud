export const PLAUD_SERVERS = {
    global: {
        label: "Global (api.plaud.ai)",
        description: "Global server — used by most accounts (api.plaud.ai)",
        apiBase: "https://api.plaud.ai",
    },
    eu: {
        label: "EU – Frankfurt (api-euc1.plaud.ai)",
        description:
            "EU server — used by European accounts (api-euc1.plaud.ai)",
        apiBase: "https://api-euc1.plaud.ai",
    },
    apac: {
        label: "Asia Pacific (api-apse1.plaud.ai)",
        description:
            "Asia Pacific server — used by APAC accounts (api-apse1.plaud.ai)",
        apiBase: "https://api-apse1.plaud.ai",
    },
} as const;

export type PlaudServerKey = keyof typeof PLAUD_SERVERS;
export const DEFAULT_SERVER_KEY: PlaudServerKey = "global";

export const PLAUD_USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
