ALTER TABLE "trips" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cover" "bytea";--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cover_type" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cover_updated_at" timestamp with time zone;