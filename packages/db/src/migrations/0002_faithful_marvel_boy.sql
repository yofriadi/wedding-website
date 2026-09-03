CREATE TABLE `rsvps` (
	`invite_id` text PRIMARY KEY NOT NULL,
	`attending` integer NOT NULL,
	`party_size` integer NOT NULL,
	`responded_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rsvps_attending_idx` ON `rsvps` (`attending`);--> statement-breakpoint
ALTER TABLE `invites` ADD `max_party_size` integer DEFAULT 1 NOT NULL;