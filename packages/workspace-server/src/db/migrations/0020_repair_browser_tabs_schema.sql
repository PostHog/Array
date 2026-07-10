-- Repair migration for profiles that dogfooded a pre-merge bluebird build.
-- Migration 0013 was amended in place on the branch (same folderMillis), so a
-- DB that ran the early panes-era version has it recorded as applied and never
-- got the rewritten tab-strip schema: `browser_windows` lacks `active_tab_id`,
-- which makes every browser-tabs query throw and leaves the tab strip dead.
-- Each ALTER below is a no-op on healthy DBs: the runner tolerates
-- "duplicate column name" (see migrate.ts) and only heals divergent tables.
ALTER TABLE `browser_windows` ADD COLUMN `active_tab_id` text;--> statement-breakpoint
ALTER TABLE `browser_tabs` ADD COLUMN `task_id` text;--> statement-breakpoint
ALTER TABLE `browser_tabs` ADD COLUMN `channel_section` text;--> statement-breakpoint
ALTER TABLE `browser_tabs` ADD COLUMN `app_view` text;
