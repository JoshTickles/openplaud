ALTER TABLE "plaud_connections" ADD COLUMN IF NOT EXISTS "refresh_token" text;--> statement-breakpoint
ALTER TABLE "plaud_connections" ADD COLUMN IF NOT EXISTS "access_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaud_connections" ADD COLUMN IF NOT EXISTS "session_expires_at" timestamp;