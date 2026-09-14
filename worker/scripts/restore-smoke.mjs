import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const worker = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(worker, "node_modules/wrangler/bin/wrangler.js");
const root = mkdtempSync(join(tmpdir(), "groblus-restore-smoke-"));
function run(cwd, args, json = false) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Wrangler failed");
  return json ? JSON.parse(result.stdout) : result.stdout;
}
try {
  const source = join(root, "source"), restore = join(root, "restore");
  for (const directory of [source, restore]) {
    mkdirSync(directory);
    writeFileSync(join(directory, "wrangler.json"), JSON.stringify({
      name: "groblus-disposable-restore-smoke", compatibility_date: "2025-09-06",
      d1_databases: [{ binding: "DB", database_name: "restore-smoke", database_id: "11111111-1111-4111-8111-111111111111", migrations_dir: join(worker, "migrations") }],
    }));
  }
  run(source, ["d1", "migrations", "apply", "DB", "--local"]);
  run(source, ["d1", "execute", "DB", "--local", "--command", "INSERT INTO users (id,email,display_name,created_at) VALUES ('restore-user','restore@example.invalid','Restore test','2026-09-13T00:00:00Z'); INSERT INTO interests VALUES ('restore-user','the-warren',1,1,'2026-09-13T00:00:00Z'); INSERT INTO availability VALUES ('restore-user',5,'afternoon','often');"]);
  const backup = join(root, "backup.sql");
  run(source, ["d1", "export", "DB", "--local", "--output", backup]);
  run(restore, ["d1", "execute", "DB", "--local", "--file", backup]);
  const rows = run(restore, ["d1", "execute", "DB", "--local", "--command", "SELECT u.display_name,i.want_play,i.want_gm,a.preference FROM users u JOIN interests i ON i.user_id=u.id JOIN availability a ON a.user_id=u.id WHERE u.id='restore-user';", "--json"], true);
  assert.deepEqual(rows[0].results, [{ display_name: "Restore test", want_play: 1, want_gm: 1, preference: "often" }]);
  const orphans = run(restore, ["d1", "execute", "DB", "--local", "--command", "SELECT count(*) AS orphans FROM interests i LEFT JOIN users u ON u.id=i.user_id LEFT JOIN games g ON g.id=i.game_id WHERE u.id IS NULL OR g.id IS NULL;", "--json"], true);
  assert.equal(orphans[0].results[0].orphans, 0);
  console.log("PASS: isolated local D1 migrated, exported, restored; linked interests/times and absence of orphaned interests verified. No development or remote data touched.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
