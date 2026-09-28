ALTER TABLE "stops" DROP CONSTRAINT "stops_arrive_by";--> statement-breakpoint
ALTER TABLE "days" ADD COLUMN "stay" jsonb;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "transport" jsonb;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_arrive_by" CHECK ("stops"."arrive_by" in ('drive', 'ferry', 'flight', 'bus', 'train', 'walk'));