import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUserStorageProvider } from "@/lib/storage/factory";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

        const { id } = await params;

        const [recording] = await db
            .select()
            .from(recordings)
            .where(
                and(
                    eq(recordings.id, id),
                    eq(recordings.userId, session.user.id),
                    eq(recordings.source, "upload"),
                ),
            )
            .limit(1);

        if (!recording) {
            return NextResponse.json(
                { error: "Voice memo not found" },
                { status: 404 },
            );
        }

        // Delete from storage
        try {
            const storage = await createUserStorageProvider(session.user.id);
            await storage.deleteFile(recording.storagePath);
        } catch (error) {
            console.error("Failed to delete file from storage:", error);
        }

        // Delete related records (cascade handles transcriptions/enhancements)
        await db
            .delete(recordings)
            .where(eq(recordings.id, id));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting voice memo:", error);
        return NextResponse.json(
            { error: "Failed to delete voice memo" },
            { status: 500 },
        );
    }
}
