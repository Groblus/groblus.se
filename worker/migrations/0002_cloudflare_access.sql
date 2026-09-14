-- Remove application-managed login credentials; preserve member IDs and preferences.
DROP TABLE sessions;
DROP TABLE recovery_codes;
ALTER TABLE users DROP COLUMN password_hash;
