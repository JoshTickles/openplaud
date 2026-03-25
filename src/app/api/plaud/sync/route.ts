import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AppError, createErrorResponse, ErrorCode } from "@/lib/errors";
import { syncRecordingsForUser } from "@/lib/sync/sync-recordings";

export async function POST(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            const error = new AppError(
                ErrorCode.UNAUTHORIZED,
                "You must be logged in to sync recordings",
                401,
            );
            const response = createErrorResponse(error);
            return NextResponse.json(response.body, {
                status: response.status,
            });
        }

        const result = await syncRecordingsForUser(session.user.id);

        return NextResponse.json({
            success: true,
            newRecordings: result.newRecordings,
            updatedRecordings: result.updatedRecordings,
            removedRecordings: result.removedRecordings,
            errors: result.errors,
        });
    } catch (error) {
        console.error("Error syncing recordings:", error);
        const response = createErrorResponse(error, ErrorCode.PLAUD_API_ERROR);
        return NextResponse.json(response.body, { status: response.status });
    }
}
