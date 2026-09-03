CREATE TABLE `submission_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`key` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_photos_submission_id_position_unique` ON `submission_photos` (`submission_id`,`position`);--> statement-breakpoint
CREATE INDEX `submission_photos_submission_id_idx` ON `submission_photos` (`submission_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_id` text NOT NULL,
	`wish_text` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_invite_id_unique` ON `submissions` (`invite_id`);--> statement-breakpoint
CREATE INDEX `submissions_created_at_idx` ON `submissions` (`created_at`);