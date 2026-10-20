-- Jadwal cron expression per item (5 field, evaluasi WIB).
-- Jalankan sekali di database yang sudah ada:
--   npx wrangler d1 execute bot-tele-db --remote --file migrations/2026-10-20-cron-expr.sql

ALTER TABLE monitors ADD COLUMN cron_expr TEXT;
ALTER TABLE monitors ADD COLUMN next_run_at INTEGER;

ALTER TABLE feeds ADD COLUMN cron_expr TEXT;
ALTER TABLE feeds ADD COLUMN next_run_at INTEGER;

ALTER TABLE alerts ADD COLUMN cron_expr TEXT;
ALTER TABLE alerts ADD COLUMN next_run_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_monitors_next ON monitors(next_run_at);
CREATE INDEX IF NOT EXISTS idx_feeds_next ON feeds(next_run_at);
CREATE INDEX IF NOT EXISTS idx_alerts_next ON alerts(next_run_at);

INSERT OR IGNORE INTO settings(key, value) VALUES ('cron_monitor', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('cron_rss', '');
INSERT OR IGNORE INTO settings(key, value) VALUES ('cron_alert', '');
