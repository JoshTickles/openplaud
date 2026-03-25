CREATE TABLE IF NOT EXISTS "recording_tags" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" varchar(50) NOT NULL,
    "color" varchar(7) NOT NULL DEFAULT '#3b82f6',
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "recording_tags_user_id_name_unique" UNIQUE("user_id", "name")
);

CREATE TABLE IF NOT EXISTS "recording_tag_assignments" (
    "id" text PRIMARY KEY NOT NULL,
    "recording_id" text NOT NULL REFERENCES "recordings"("id") ON DELETE CASCADE,
    "tag_id" text NOT NULL REFERENCES "recording_tags"("id") ON DELETE CASCADE,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "recording_tag_assignments_recording_id_tag_id_unique" UNIQUE("recording_id", "tag_id")
);

CREATE INDEX IF NOT EXISTS "recording_tags_user_id_idx" ON "recording_tags" ("user_id");
CREATE INDEX IF NOT EXISTS "tag_assignments_recording_id_idx" ON "recording_tag_assignments" ("recording_id");
CREATE INDEX IF NOT EXISTS "tag_assignments_tag_id_idx" ON "recording_tag_assignments" ("tag_id");
