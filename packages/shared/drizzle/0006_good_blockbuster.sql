ALTER TABLE "missions" ADD COLUMN "call_limit" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "fallback_model" text;