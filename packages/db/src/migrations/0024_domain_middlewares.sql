ALTER TABLE `domains` ADD `basic_auth` text;
ALTER TABLE `domains` ADD `ip_allowlist` text;
ALTER TABLE `domains` ADD `rate_limit_average` integer;
ALTER TABLE `domains` ADD `rate_limit_burst` integer;
