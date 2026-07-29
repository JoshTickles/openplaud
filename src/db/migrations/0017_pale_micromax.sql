CREATE TABLE IF NOT EXISTS "speaker_voiceprints" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"embedding" jsonb NOT NULL,
	"sample_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "speaker_voiceprints_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "speaker_voiceprints" ADD CONSTRAINT "speaker_voiceprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "speaker_voiceprints_user_id_idx" ON "speaker_voiceprints" USING btree ("user_id");
