CREATE TABLE `guest_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_id` text NOT NULL,
	`key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guest_photos_invite_id_unique` ON `guest_photos` (`invite_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `guest_photos_key_unique` ON `guest_photos` (`key`);--> statement-breakpoint
CREATE INDEX `guest_photos_created_at_id_idx` ON `guest_photos` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`seen_at` integer,
	`seen_count` integer DEFAULT 0 NOT NULL,
	`opened_at` integer,
	`opened_count` integer DEFAULT 0 NOT NULL,
	`parent_id` text,
	`type` text DEFAULT 'individual' NOT NULL,
	`max_members` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invites_type_chk" CHECK("invites"."type" IN ('individual','group')),
	CONSTRAINT "invites_group_shape_chk" CHECK(("invites"."type" = 'group') = ("invites"."max_members" IS NOT NULL)),
	CONSTRAINT "invites_member_shape_chk" CHECK("invites"."parent_id" IS NULL OR "invites"."type" = 'individual'),
	CONSTRAINT "invites_max_members_range_chk" CHECK("invites"."max_members" IS NULL OR "invites"."max_members" BETWEEN 2 AND 50)
);
--> statement-breakpoint
CREATE INDEX `invites_parent_id_idx` ON `invites` (`parent_id`);--> statement-breakpoint
CREATE TABLE `rsvps` (
	`invite_id` text PRIMARY KEY NOT NULL,
	`attending` integer NOT NULL,
	`responded_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rsvps_attending_idx` ON `rsvps` (`attending`);