CREATE TABLE `evaluations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`run_id` text NOT NULL,
	`score` integer,
	`verdict` text,
	`summary` text,
	`eval_json` text,
	`error` text,
	`raw_output` text,
	`request_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text,
	`profile_url` text,
	`name` text NOT NULL,
	`profile_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_run_provider_target` ON `profiles` (`run_id`,`provider`,`profile_url`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`service_type` text NOT NULL,
	`model` text NOT NULL,
	`location` text,
	`created_at` text NOT NULL
);
