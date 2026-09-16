CREATE TABLE memberships (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  paid_through_year INTEGER NOT NULL CHECK(paid_through_year BETWEEN 2000 AND 2200),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
