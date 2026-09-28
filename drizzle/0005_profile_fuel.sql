ALTER TABLE "trips" ADD COLUMN "diesel_price" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "petrol_price" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vehicle" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "fuel_l_per_100km" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "fuel_type" text;