-- Interval per item + status monitor yang bisa dijeda.
-- Jalankan sekali di database yang sudah ada:
--   npx wrangler d1 execute bot-tele-db --remote --file migrations/2026-10-20-intervals.sql

ALTER TABLE monitors ADD COLUMN interval_min INTEGER NOT NULL DEFAULT 5;
ALTER TABLE monitors ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;

ALTER TABLE feeds ADD COLUMN interval_min INTEGER NOT NULL DEFAULT 10;

ALTER TABLE alerts ADD COLUMN interval_min INTEGER NOT NULL DEFAULT 15;
ALTER TABLE alerts ADD COLUMN last_checked INTEGER;

INSERT OR IGNORE INTO settings(key, value) VALUES ('interval_monitor', '5');
INSERT OR IGNORE INTO settings(key, value) VALUES ('interval_rss', '10');
INSERT OR IGNORE INTO settings(key, value) VALUES ('interval_alert', '15');
