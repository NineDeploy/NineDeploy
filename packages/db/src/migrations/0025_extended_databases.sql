ALTER TABLE `databases` ADD `web_gui_enabled` integer DEFAULT false NOT NULL;
ALTER TABLE `databases` ADD `web_gui_port` integer;
ALTER TABLE `databases` ADD `extensions` text DEFAULT '[]' NOT NULL;
