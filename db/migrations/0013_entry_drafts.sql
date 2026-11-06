CREATE TABLE "entry_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"identity" text NOT NULL,
	"path" text,
	"base_sha" text,
	"values" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"request_id" text NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_draft" ADD CONSTRAINT "entry_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_draft_identity" ON "entry_draft" USING btree ("user_id","scope","identity");--> statement-breakpoint
CREATE INDEX "entry_draft_path" ON "entry_draft" USING btree ("user_id","scope","path");