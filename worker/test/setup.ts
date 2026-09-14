import { beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import type { Env as AppEnv } from "../src/types";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
// Vitest 4 isolates D1 per file, not per test. Preserve the previous per-test
// database contract explicitly, after each file's beforeAll applies migrations.
beforeEach(async () => {
  const tables = [
    "votes",
    "plan_options",
    "plans",
    "interests",
    "availability",
    "discord_link_codes",
    "discord_interactions",
    "invites",
    "rate_limits",
    "users",
    "games",
  ];
  await env.DB.batch([
    ...tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare(
      "INSERT INTO games VALUES ('the-warren','The Warren','the warren','rpg',datetime('now')),('ars-magica','Ars Magica','ars magica','rpg',datetime('now'))",
    ),
  ]);
});
