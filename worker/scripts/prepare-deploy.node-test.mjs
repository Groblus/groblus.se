import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const valid = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  GROBLUS_D1_ID: "12345678-1234-1234-1234-123456789abc",
  GROBLUS_D1_NAME: "test-staging",
  GROBLUS_APP_ORIGIN: "https://app.example",
  GROBLUS_SITE_ORIGIN: "https://site.example",
  ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
  ACCESS_AUD: "c".repeat(64),
};
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "groblus-deploy-test-"));
  try {
    mkdirSync(join(root, "worker/scripts"), { recursive: true });
    cpSync(new URL("./prepare-deploy.mjs", import.meta.url), join(root, "worker/scripts/prepare-deploy.mjs"));
    mkdirSync(join(root, "_site/spelhyllan/design"), { recursive: true });
    writeFileSync(join(root, "_site/spelhyllan/index.html"), "test app");
    writeFileSync(join(root, "_site/spelhyllan/design/index.html"), "private sketch");
    writeFileSync(join(root, "_headers"), "test headers");
    const invoke = (args, overrides = {}) => spawnSync(process.execPath, [join(root, "worker/scripts/prepare-deploy.mjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, ...valid, DISCORD_PUBLIC_KEY: "", DISCORD_GUILD_ID: "", ...overrides },
    });
    run(invoke, root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("web-only staging omits both Discord variables and keeps only app assets", () => fixture((invoke, root) => {
  const result = invoke(["staging", "--web-only"], { DISCORD_PUBLIC_KEY: "inherited", DISCORD_GUILD_ID: "inherited" });
  assert.equal(result.status, 0, result.stderr);
  const output = join(root, "worker/.wrangler/deploy/staging");
  const config = JSON.parse(readFileSync(join(output, "wrangler.json"), "utf8"));
  assert.deepEqual(config.vars, { APP_ORIGIN: valid.GROBLUS_APP_ORIGIN, SITE_ORIGIN: valid.GROBLUS_SITE_ORIGIN, ACCESS_TEAM_DOMAIN: valid.ACCESS_TEAM_DOMAIN, ACCESS_AUD: valid.ACCESS_AUD });
  assert.equal(config.d1_databases[0].database_id, valid.GROBLUS_D1_ID);
  assert.equal(existsSync(join(output, "assets/spelhyllan/index.html")), true);
  assert.equal(existsSync(join(output, "assets/spelhyllan/design")), false);
}));

test("default requires complete Discord config and supports enabling it after web-only", () => fixture((invoke, root) => {
  assert.match(invoke(["staging"]).stderr, /Missing or invalid DISCORD_PUBLIC_KEY/);
  assert.equal(invoke(["staging", "--web-only"]).status, 0);
  const discord = { DISCORD_PUBLIC_KEY: "b".repeat(64), DISCORD_GUILD_ID: "12345678901234567" };
  assert.match(invoke(["staging"], { DISCORD_PUBLIC_KEY: discord.DISCORD_PUBLIC_KEY }).stderr, /Missing or invalid DISCORD_GUILD_ID/);
  assert.equal(invoke(["staging"], discord).status, 0);
  const config = JSON.parse(readFileSync(join(root, "worker/.wrangler/deploy/staging/wrangler.json"), "utf8"));
  assert.equal(config.vars.DISCORD_PUBLIC_KEY, discord.DISCORD_PUBLIC_KEY);
  assert.equal(config.vars.DISCORD_GUILD_ID, discord.DISCORD_GUILD_ID);
}));

test("web-only cannot bypass environment validation or enable production", () => fixture((invoke, root) => {
  for (const [args, overrides, error] of [
    [["production", "--web-only"], {}, /only available for staging/],
    [["staging", "--web-ony"], {}, /Usage:/],
    [["staging", "--web-only"], { GROBLUS_D1_ID: "00000000-0000-0000-0000-000000000000" }, /real D1/],
    [["staging", "--web-only"], { GROBLUS_APP_ORIGIN: "http://app.example" }, /HTTPS origin/],
    [["staging", "--web-only"], { ACCESS_TEAM_DOMAIN: "" }, /ACCESS_TEAM_DOMAIN/],
    [["staging", "--web-only"], { ACCESS_TEAM_DOMAIN: "https://example.com" }, /ACCESS_TEAM_DOMAIN/],
    [["staging", "--web-only"], { ACCESS_AUD: "" }, /ACCESS_AUD/],
    [["staging", "--web-only"], { GROBLUS_SITE_ORIGIN: valid.GROBLUS_APP_ORIGIN }, /separate origin/],
  ]) {
    const result = invoke(args, overrides);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
  }
  assert.equal(existsSync(join(root, "worker/.wrangler")), false);
}));
