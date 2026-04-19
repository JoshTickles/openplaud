-- Add source column to distinguish Plaud synced recordings from user uploads
ALTER TABLE "recordings" ADD COLUMN "source" varchar(10) NOT NULL DEFAULT 'plaud';

-- Make Plaud-specific columns nullable for user-uploaded recordings
ALTER TABLE "recordings" ALTER COLUMN "device_sn" DROP NOT NULL;
ALTER TABLE "recordings" ALTER COLUMN "plaud_file_id" DROP NOT NULL;
ALTER TABLE "recordings" ALTER COLUMN "file_md5" DROP NOT NULL;
ALTER TABLE "recordings" ALTER COLUMN "plaud_version" DROP NOT NULL;

-- Drop the old unique constraint on plaud_file_id (it was NOT NULL before)
-- and re-add it as a partial unique index (only for non-null values)
ALTER TABLE "recordings" DROP CONSTRAINT IF EXISTS "recordings_plaud_file_id_unique";
CREATE UNIQUE INDEX "recordings_plaud_file_id_unique" ON "recordings" ("plaud_file_id") WHERE "plaud_file_id" IS NOT NULL;

-- Index for filtering by source
CREATE INDEX "recordings_source_idx" ON "recordings" ("user_id", "source");
