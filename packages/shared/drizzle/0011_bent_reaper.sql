CREATE TYPE "public"."meeting_kind" AS ENUM('KICKOFF', 'RETRO');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('RUNNING', 'DONE');--> statement-breakpoint
CREATE TABLE "meeting_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"speaker_type" "actor_type" NOT NULL,
	"agent_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"kind" "meeting_kind" NOT NULL,
	"status" "meeting_status" DEFAULT 'RUNNING' NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conclusion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "meetings" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_turns" ADD CONSTRAINT "meeting_turns_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_turns" ADD CONSTRAINT "meeting_turns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;