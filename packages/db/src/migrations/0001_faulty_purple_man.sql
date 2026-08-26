ALTER TABLE `invites` ADD `opened_at` integer;--> statement-breakpoint
ALTER TABLE `invites` ADD `opened_count` integer DEFAULT 0 NOT NULL;