CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid,
	"name" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "labels_kind" CHECK ("labels"."kind" in ('tag', 'category'))
);
--> statement-breakpoint
ALTER TABLE "stops" DROP CONSTRAINT "stops_tags";--> statement-breakpoint
ALTER TABLE "checklist_items" ALTER COLUMN "trip_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD COLUMN "checklist_id" uuid;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "categories" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklists_user" ON "checklists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_user_kind_name" ON "labels" USING btree ("user_id","kind","name");--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "checklists" ("user_id", "trip_id", "name", "tags")
SELECT t."owner_id", t."id", t."name" || ' bookings', '{bookings}'
FROM "trips" t
WHERE EXISTS (SELECT 1 FROM "checklist_items" i WHERE i."trip_id" = t."id");--> statement-breakpoint
UPDATE "checklist_items" i SET "checklist_id" = c."id" FROM "checklists" c WHERE c."trip_id" = i."trip_id";
