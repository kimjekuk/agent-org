CREATE TYPE "public"."schedule_kind" AS ENUM('MISSION', 'DIRECTIVE');--> statement-breakpoint
CREATE TYPE "public"."schedule_repeat" AS ENUM('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "schedule_kind" NOT NULL,
	"title" text NOT NULL,
	"spec" jsonb NOT NULL,
	"agent_id" uuid,
	"repeat" "schedule_repeat" NOT NULL,
	"time" text NOT NULL,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"day_of_month" integer,
	"run_date" text,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_mission_id" uuid,
	"last_result" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;