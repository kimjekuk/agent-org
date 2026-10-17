ALTER TABLE "approval_requests" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "reference_notes" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reject_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;