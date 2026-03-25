ALTER TABLE "recordings" ADD COLUMN IF NOT EXISTS "upstream_deleted" boolean NOT NULL DEFAULT false;
