import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordingTags } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const tags = await db
            .select()
            .from(recordingTags)
            .where(eq(recordingTags.userId, session.user.id))
            .orderBy(recordingTags.name);

        return NextResponse.json({ tags });
    } catch (error) {
        console.error("Error fetching tags:", error);
        return NextResponse.json(
            { error: "Failed to fetch tags" },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const body = await request.json();
        const { name, color } = body;

        if (!name || typeof name !== "string" || name.trim().length === 0) {
            return NextResponse.json(
                { error: "Tag name is required" },
                { status: 400 },
            );
        }

        const cleanName = name.trim().substring(0, 50);

        if (color && (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
            return NextResponse.json(
                { error: "Color must be a valid hex color (e.g. #3b82f6)" },
                { status: 400 },
            );
        }

        const [tag] = await db
            .insert(recordingTags)
            .values({
                userId: session.user.id,
                name: cleanName,
                ...(color ? { color } : {}),
            })
            .returning();

        return NextResponse.json({ tag }, { status: 201 });
    } catch (error) {
        const msg = String((error as Error).message || "");
        if (msg.includes("unique") || msg.includes("duplicate")) {
            return NextResponse.json(
                { error: "A tag with that name already exists" },
                { status: 409 },
            );
        }
        console.error("Error creating tag:", error);
        return NextResponse.json(
            { error: "Failed to create tag" },
            { status: 500 },
        );
    }
}
