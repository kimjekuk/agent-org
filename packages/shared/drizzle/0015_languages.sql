ALTER TABLE "agents" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "language" text DEFAULT 'ko' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text DEFAULT 'ko' NOT NULL;