import { randomBytes, createHash } from "node:crypto";
import { parseWranglerJson } from "./wrangler-json.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const positional = [];
let config;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--remote") continue;
  if (args[i] === "--config") {
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("--config requires a path");
    config = resolve(args[++i]);
  } else if (args[i].startsWith("--")) throw new Error("Unknown option");
  else positional.push(args[i]);
}
if (remote && !config) throw new Error("Remote admin requires --config pointing to the prepared deployment configuration");
const [action, value] = positional;
if (action !== "invite" || positional.length > 2) {
  throw new Error("Usage: node scripts/admin.mjs invite [uses] [--remote --config path]. Discord invitations only; website access is managed in Cloudflare Access.");
}
const uses = Number(value ?? 1);
if (!Number.isInteger(uses) || uses < 1 || uses > 100)
  throw new Error("Uses must be 1–100");
const code = randomBytes(24).toString("hex");
const hash = createHash("sha256").update(code).digest("hex");
const expires = new Date(Date.now() + 7 * 86400000).toISOString();
const sql = `INSERT INTO invites (code_hash,uses_remaining,expires_at) VALUES ('${hash}',${uses},'${expires}'); SELECT changes() AS created;`;
const dir = mkdtempSync(join(tmpdir(), "groblus-admin-"));
try {
  const file = join(dir, "statement.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      ...(config ? ["--config", config] : []),
      remote ? "--remote" : "--local",
      ...(remote ? ["--command", sql] : ["--file", file]),
      "--json",
    ],
    { encoding: "utf8", shell: false, cwd: resolve(dirname(fileURLToPath(import.meta.url)), "..") },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Database operation failed.\n");
    process.exitCode = 1;
  } else {
    const output = parseWranglerJson(result.stdout);
    const created = output
      .flatMap((item) => item.results ?? [])
      .some((row) => row.created === 1);
    if (!created)
      throw new Error("No Discord invitation created.");
    console.log(
      `${remote ? "REMOTE" : "LOCAL"} Discord invitation code (share privately): ${code}\nExpires: ${expires}`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
