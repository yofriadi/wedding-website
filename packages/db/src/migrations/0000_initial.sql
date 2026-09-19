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
	`opened_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rsvps` (
	`invite_id` text PRIMARY KEY NOT NULL,
	`attending` integer NOT NULL,
	`responded_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rsvps_attending_idx` ON `rsvps` (`attending`);