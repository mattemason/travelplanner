CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"due_date" date,
	"status" text DEFAULT 'todo' NOT NULL,
	"url" text,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "checklist_status" CHECK ("checklist_items"."status" in ('todo', 'in_progress', 'done'))
);
--> statement-breakpoint
CREATE TABLE "days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"date" date NOT NULL,
	"leg_id" uuid,
	"overnight_place_id" uuid,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "fixed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"type" text NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"location" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"travellers" text[] DEFAULT '{}' NOT NULL,
	"colour" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_list_items" (
	"list_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	CONSTRAINT "place_list_items_list_id_place_id_pk" PRIMARY KEY("list_id","place_id")
);
--> statement-breakpoint
CREATE TABLE "place_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"trip_id" uuid,
	CONSTRAINT "place_lists_source" CHECK ("place_lists"."source" in ('takeout', 'share_link', 'csv', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_place_id" text,
	"name" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"address" text,
	"business_status" text,
	"photo_ref" text,
	"hours_json" jsonb,
	"source_list" text,
	"maps_url" text,
	"notes" text,
	"last_enriched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prompt_json" jsonb NOT NULL,
	"proposal_json" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "plan_proposals_status" CHECK ("plan_proposals"."status" in ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "route_segments" (
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"duration_s" integer NOT NULL,
	"distance_m" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_segments_origin_destination_pk" PRIMARY KEY("origin","destination")
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"token" text NOT NULL,
	"leg_filter" uuid,
	"expires_at" timestamp with time zone,
	CONSTRAINT "shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"planned_time" time,
	"duration_mins" integer,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'planned' NOT NULL,
	CONSTRAINT "stops_tags" CHECK ("stops"."tags" <@ array['4wd','walk','camp','permit','book_ahead','weather']),
	CONSTRAINT "stops_status" CHECK ("stops"."status" in ('planned', 'done', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"diff_json" jsonb,
	"applied" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_point" text,
	"end_point" text,
	"max_drive_hours_per_day" numeric(4, 2) DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_dates" CHECK ("trips"."end_date" >= "trips"."start_date")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"home_region" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "days" ADD CONSTRAINT "days_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "days" ADD CONSTRAINT "days_leg_id_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."legs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "days" ADD CONSTRAINT "days_overnight_place_id_places_id_fk" FOREIGN KEY ("overnight_place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_events" ADD CONSTRAINT "fixed_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_list_items" ADD CONSTRAINT "place_list_items_list_id_place_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."place_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_list_items" ADD CONSTRAINT "place_list_items_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_lists" ADD CONSTRAINT "place_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_lists" ADD CONSTRAINT "place_lists_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_proposals" ADD CONSTRAINT "plan_proposals_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_leg_filter_legs_id_fk" FOREIGN KEY ("leg_filter") REFERENCES "public"."legs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_day_id_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "days_trip_date" ON "days" USING btree ("trip_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "places_user_google_place" ON "places" USING btree ("user_id","google_place_id") WHERE "places"."google_place_id" is not null;--> statement-breakpoint
CREATE INDEX "stops_day_position" ON "stops" USING btree ("day_id","position");