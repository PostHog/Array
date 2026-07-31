CREATE TABLE IF NOT EXISTS `product_environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`label` text NOT NULL,
	`page_origin` text NOT NULL,
	`data_project_id` integer NOT NULL,
	`current_url` text,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `product_environments_project_idx` ON `product_environments` (`project_id`);
