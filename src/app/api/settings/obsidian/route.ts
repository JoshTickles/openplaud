import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/encryption";

interface ObsidianConfigInput {
    enabled?: boolean;
    apiUrl?: string;
    apiKey?: string;
    vaultPath?: string;
    autoExport?: boolean;
}

interface ObsidianConfigStored {
    enabled: boolean;
    apiUrl: string;
    encryptedApiKey?: string;
    vaultPath: string;
    autoExport: boolean;
}

export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const [settings] = await db
            .select({ obsidianConfig: userSettings.obsidianConfig })
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        if (!settings?.obsidianConfig) {
            return NextResponse.json({
                enabled: false,
                apiUrl: "http://localhost:27123",
                apiKey: "",
                vaultPath: "",
                autoExport: false,
            });
        }

        const stored = settings.obsidianConfig as ObsidianConfigStored;

        return NextResponse.json({
            enabled: stored.enabled ?? false,
            apiUrl: stored.apiUrl ?? "http://localhost:27123",
            apiKey: stored.encryptedApiKey
                ? decrypt(stored.encryptedApiKey)
                : "",
            vaultPath: stored.vaultPath ?? "",
            autoExport: stored.autoExport ?? false,
        });
    } catch (error) {
        console.error("Error fetching Obsidian settings:", error);
        return NextResponse.json(
            { error: "Failed to fetch settings" },
            { status: 500 },
        );
    }
}

export async function PUT(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body: ObsidianConfigInput = await request.json();

        const storedConfig: ObsidianConfigStored = {
            enabled: body.enabled ?? false,
            apiUrl: body.apiUrl ?? "http://localhost:27123",
            encryptedApiKey: body.apiKey ? encrypt(body.apiKey) : undefined,
            vaultPath: body.vaultPath ?? "",
            autoExport: body.autoExport ?? false,
        };

        const [existing] = await db
            .select({ id: userSettings.id })
            .from(userSettings)
            .where(eq(userSettings.userId, session.user.id))
            .limit(1);

        if (existing) {
            await db
                .update(userSettings)
                .set({
                    obsidianConfig: storedConfig,
                    updatedAt: new Date(),
                })
                .where(eq(userSettings.userId, session.user.id));
        } else {
            await db.insert(userSettings).values({
                userId: session.user.id,
                obsidianConfig: storedConfig,
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error saving Obsidian settings:", error);
        return NextResponse.json(
            { error: "Failed to save settings" },
            { status: 500 },
        );
    }
}
