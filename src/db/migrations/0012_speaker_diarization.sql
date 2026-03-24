ALTER TABLE "user_settings"
    ADD COLUMN IF NOT EXISTS "speaker_diarization" boolean NOT NULL DEFAULT false;

ALTER TABLE "user_settings"
    ADD COLUMN IF NOT EXISTS "diarization_speakers" integer;
