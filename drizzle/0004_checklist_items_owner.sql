ALTER TABLE "checklist_items" DROP CONSTRAINT "checklist_items_trip_id_trips_id_fk";
--> statement-breakpoint
ALTER TABLE "checklist_items" ALTER COLUMN "checklist_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "checklist_items" DROP COLUMN "trip_id";