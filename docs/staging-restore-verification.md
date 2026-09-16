# Staging D1 restore verification

Verified 2026-09-14T14:41:40+00:00 with Wrangler 4.131.1.

## Scope and resources

- Source: `groblus-spelhyllan-staging`, D1 `c11d6753-9fa2-4fc6-8fd0-1d454ca1df91`, EU jurisdiction.
- Restore destination: `groblus-spelhyllan-restore-check`, D1 `3a3ee8a2-5abc-4672-961a-a7b0453d14fe`, created with `--jurisdiction eu`; Cloudflare reported EEUR.
- The destination was absent from the initial database list. After creation, its application-table count was verified as zero before import. No existing database was overwritten.
- No source/staging writes, production changes, plan upgrades, remote resource deletions, or Worker bindings were performed by this verification.

## Evidence

The source was exported using `wrangler d1 export DB --remote --config .wrangler/deploy/staging/wrangler.json --output <private-file>`. The export was imported into the empty remote restore destination with `wrangler d1 execute RESTORE --remote --config <private-config> --file <private-file> --yes`.

Export size: 3434 bytes. SHA-256: `5de7599be2f3a5dbd133e2389f35bb04db2323c3548ff63f63bcf2dd5591e661`.

All 14 exported table counts matched the remote restored database:

| Table | Rows |
|---|---:|
| `d1_migrations` | 1 |
| `users` | 0 |
| `games` | 2 |
| `interests` | 0 |
| `availability` | 0 |
| `plans` | 0 |
| `plan_options` | 0 |
| `votes` | 0 |
| `discord_link_codes` | 0 |
| `invites` | 1 |
| `sessions` | 0 |
| `recovery_codes` | 0 |
| `rate_limits` | 0 |
| `discord_interactions` | 0 |

`PRAGMA foreign_key_check` returned no rows after import.

Because the source contained no user activity, a synthetic user, play-and-GM interest, Saturday availability, confirmed plan, date option, and affirmative vote were inserted only into the restore database. A remote join verified the linked records and both independent interest flags. Foreign-key checks remained clean. A second export of this populated restore database was imported into an isolated in-memory SQLite database; both interest flags and the vote survived, and foreign-key checks passed again.

The initial count query exceeded D1's compound-SELECT limit. Replacing the UNION query with separate SELECT statements succeeded; this was a verification-query limitation, not a schema defect.

## Retention and limits

The restore database remains isolated and retained for inspection. It contains the restored staging invitation hash and synthetic test records, so it must not be attached to the public app. Backup SQL and config are outside the repository in a private temporary directory (directory mode 0700, files mode 0600); no SQL contents or invitation values were logged or added to documentation.

This verifies an actual staging export/import into remote D1 and synthetic relational persistence. The synthetic populated export was re-imported locally, not into a second remote destination. It does not establish a scheduled backup policy, production recovery, retention guarantees for temporary files, or live Discord acceptance. A production-sized recovery rehearsal remains a future operational check once production data exists.
