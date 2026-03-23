import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { apiUrl, apiKey } = await request.json();

        if (!apiUrl) {
            return NextResponse.json(
                { error: "API URL is required" },
                { status: 400 },
            );
        }

        const baseUrl = apiUrl.replace(/\/$/, "");
        const response = await fetch(`${baseUrl}/`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(5000),
        });

        if (response.ok || response.status === 200) {
            return NextResponse.json({ success: true });
        }

        return NextResponse.json(
            { error: `Obsidian API returned ${response.status}` },
            { status: 502 },
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Connection failed";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
