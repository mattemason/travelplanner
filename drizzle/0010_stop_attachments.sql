CREATE TABLE "stop_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stop_attachments" ADD CONSTRAINT "stop_attachments_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stop_attachments_stop" ON "stop_attachments" USING btree ("stop_id");