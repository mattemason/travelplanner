ALTER TABLE "stops" DROP CONSTRAINT "stops_day_id_days_id_fk";
--> statement-breakpoint
DROP INDEX "stops_day_position";--> statement-breakpoint
ALTER TABLE "stops" ALTER COLUMN "day_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "route_segments" ADD COLUMN "polyline" text;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
UPDATE "stops" SET "trip_id" = "days"."trip_id" FROM "days" WHERE "days"."id" = "stops"."day_id";--> statement-breakpoint
ALTER TABLE "stops" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "booking_ref" text;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "seed_version" integer;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_day_id_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stops_trip_day_position" ON "stops" USING btree ("trip_id","day_id","position");