ALTER TABLE "agents" ADD COLUMN "speech_tone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "office_theme" text DEFAULT 'DEFAULT' NOT NULL;