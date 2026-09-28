CREATE TABLE "stop_chats" (
	"stop_id" uuid PRIMARY KEY NOT NULL,
	"messages" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stop_chats" ADD CONSTRAINT "stop_chats_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;