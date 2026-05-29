CREATE TABLE `home_workflow_config` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`json` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
