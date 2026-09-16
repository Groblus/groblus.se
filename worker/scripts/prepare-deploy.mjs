import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const worker = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [target, ...options] = process.argv.slice(2);
if (options.some((option) => option !== "--web-only") || options.length > 1)
  throw new Error("Usage: prepare-deploy.mjs staging|production [--web-only]");
const webOnly = options.includes("--web-only");
if (webOnly && target !== "staging")
  throw new Error("--web-only is only available for staging; production requires Discord configuration");
if (!["staging", "production"].includes(target))
  throw new Error("Choose staging or production. This script prepares local files only.");
const required = (name, pattern) => {
  const value = process.env[name] || "";
  if (!pattern.test(value)) throw new Error(`Missing or invalid ${name}`);
  return value;
};
const origin = (name) => {
  const value = process.env[name];
  let url;
  try { url = new URL(value); } catch { throw new Error(`Set ${name} to an HTTPS origin`); }
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password)
    throw new Error(`${name} must be an HTTPS origin without a path or trailing slash`);
  return value;
};
const account = required("CLOUDFLARE_ACCOUNT_ID", /^[a-f0-9]{32}$/i);
const database = required("GROBLUS_D1_ID", /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
if (/^0{8}(-0{4}){3}-0{12}$/.test(database)) throw new Error("A real D1 database ID is required");
const databaseName = required("GROBLUS_D1_NAME", /^[a-zA-Z0-9_-]+$/);
const appOrigin = origin("GROBLUS_APP_ORIGIN");
const siteOrigin = origin("GROBLUS_SITE_ORIGIN");
if (appOrigin === siteOrigin) throw new Error("App must use a separate origin to preserve the existing Netlify website");
const accessVars = {
  ACCESS_TEAM_DOMAIN: required("ACCESS_TEAM_DOMAIN", /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/),
  ACCESS_AUD: required("ACCESS_AUD", /^[a-f0-9]{64}$/i),
};
const discordVars = webOnly ? {} : {
  DISCORD_PUBLIC_KEY: required("DISCORD_PUBLIC_KEY", /^[a-f0-9]{64}$/i),
  DISCORD_GUILD_ID: required("DISCORD_GUILD_ID", /^\d{17,20}$/),
};
const directory = join(worker, ".wrangler", "deploy", target);
mkdirSync(directory, { recursive: true });
const assets = join(directory, "assets");
rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });
cpSync(join(worker, "..", "_site", "spelhyllan"), join(assets, "spelhyllan"), { recursive: true });
// Sketches are preserved in the repository, not shipped as member-facing app routes.
rmSync(join(assets, "spelhyllan", "design"), { recursive: true, force: true });
cpSync(join(worker, "..", "_headers"), join(assets, "_headers"));
const config = {
  name: target === "production" ? "groblus-spelhyllan" : "groblus-spelhyllan-staging",
  account_id: account,
  main: "../../../src/index.ts",
  compatibility_date: "2025-09-06",
  workers_dev: true,
  assets: { directory: "./assets", binding: "ASSETS", run_worker_first: true },
  vars: { APP_ORIGIN: appOrigin, SITE_ORIGIN: siteOrigin, ...accessVars, ...discordVars, ...(process.env.ADMIN_EMAILS ? {ADMIN_EMAILS: process.env.ADMIN_EMAILS} : {}) },
  d1_databases: [{ binding: "DB", database_name: databaseName, database_id: database, migrations_dir: "../../../migrations" }],
  triggers: { crons: ["17 * * * *"] },
};
const output = join(directory, "wrangler.json");
writeFileSync(output, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(`Prepared ${target}${webOnly ? " (web only; Discord disabled)" : ""}: ${output}\nNo resources created or deployed. Re-run after each app build.`);
