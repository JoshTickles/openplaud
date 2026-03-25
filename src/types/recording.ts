import type { InferSelectModel } from "drizzle-orm";
import type { recordings } from "@/db/schema";

export interface Tag {
    id: string;
    name: string;
    color: string;
}

export type RecordingQueryResult = Pick<
    InferSelectModel<typeof recordings>,
    | "id"
    | "filename"
    | "duration"
    | "startTime"
    | "filesize"
    | "deviceSn"
    | "upstreamDeleted"
>;

export type Recording = Omit<RecordingQueryResult, "startTime"> & {
    startTime: string;
    tags?: Tag[];
};

export function serializeRecording(recording: RecordingQueryResult): Recording {
    return {
        ...recording,
        startTime: recording.startTime.toISOString(),
    };
}
