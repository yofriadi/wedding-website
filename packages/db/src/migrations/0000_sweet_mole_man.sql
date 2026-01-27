CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`seen_at` integer,
	`seen_count` integer DEFAULT 0 NOT NULL
);
