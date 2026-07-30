CREATE TABLE IF NOT EXISTS "voiceprint_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"voiceprint_id" text NOT NULL,
	"recording_id" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"seg_start" real,
	"seg_end" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "voiceprint_samples_voiceprint_id_recording_id_unique" UNIQUE("voiceprint_id","recording_id")
);
--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN IF NOT EXISTS "speaker_segments" jsonb;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "voiceprint_samples" ADD CONSTRAINT "voiceprint_samples_voiceprint_id_speaker_voiceprints_id_fk" FOREIGN KEY ("voiceprint_id") REFERENCES "public"."speaker_voiceprints"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "voiceprint_samples" ADD CONSTRAINT "voiceprint_samples_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voiceprint_samples_voiceprint_id_idx" ON "voiceprint_samples" USING btree ("voiceprint_id");
