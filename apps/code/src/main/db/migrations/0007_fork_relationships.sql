CREATE TABLE `fork_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`forked_task_id` text NOT NULL,
	`source_task_id` text NOT NULL,
	`source_task_run_id` text NOT NULL,
	`source_task_title` text NOT NULL,
	`fork_at_message_index` integer NOT NULL,
	`forked_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fork_relationships_forked_task_id_unique` ON `fork_relationships` (`forked_task_id`);
