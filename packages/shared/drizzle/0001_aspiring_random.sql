ALTER TABLE "artifacts" ALTER COLUMN "mission_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "org_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;