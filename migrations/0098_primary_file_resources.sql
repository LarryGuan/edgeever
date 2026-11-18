PRAGMA foreign_keys = ON;

ALTER TABLE resources ADD COLUMN role TEXT NOT NULL DEFAULT 'attachment' CHECK (role IN ('attachment', 'primary'));
ALTER TABLE resources ADD COLUMN format_key TEXT;

CREATE UNIQUE INDEX idx_resources_one_active_primary_per_memo
  ON resources(memo_id)
  WHERE role = 'primary' AND is_deleted = 0;
