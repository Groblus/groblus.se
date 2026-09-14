import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

describe("standalone app routing", () => {
  const appEnv = (site = "https://groblus.example") => ({
    ...env, SITE_ORIGIN: site,
    ASSETS: { fetch: vi.fn(async () => new Response("app asset")) } as unknown as Fetcher,
  });
  it("keeps app/API local and redirects website paths to the existing website", async () => {
    const bindings = appEnv();
    for (const path of ["/spelhyllan/", "/spelhyllan/app.js"]) {
      const result = await worker.fetch(new Request(`https://app.example${path}`), bindings);
      expect(await result.text()).toBe("app asset");
    }
    const api = await worker.fetch(new Request("https://app.example/api/me"), bindings);
    expect(api.status).toBe(401);
    const result = await worker.fetch(new Request("https://app.example/kontakt?from=app"), bindings);
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("https://groblus.example/kontakt?from=app");
    const hostile = await worker.fetch(new Request("https://app.example//elsewhere.example"), bindings);
    expect(new URL(hostile.headers.get("location")!).origin).toBe("https://groblus.example");
    const post = await worker.fetch(new Request("https://app.example/", { method: "POST", body: "private form data" }), bindings);
    expect(post.status).toBe(404);
    expect(post.headers.has("location")).toBe(false);
  });
  it("rejects Discord interactions when web-only deployment omits configuration", async () => {
    const bindings = appEnv();
    delete (bindings as Env).DISCORD_PUBLIC_KEY;
    delete (bindings as Env).DISCORD_GUILD_ID;
    const response = await worker.fetch(new Request("https://app.example/api/discord/interactions", {
      method: "POST",
      headers: { "X-Signature-Ed25519": "a".repeat(128), "X-Signature-Timestamp": String(Math.floor(Date.now() / 1000)) },
      body: JSON.stringify({ type: 1 }),
    }), bindings);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid signature" });
  });
  it("leaves development unchanged and rejects unsafe redirect configuration", async () => {
    const bindings = appEnv();
    delete (bindings as Env).SITE_ORIGIN;
    expect(await (await worker.fetch(new Request("http://localhost:8787/"), bindings)).text()).toBe("app asset");
    for (const site of ["http://groblus.example", "https://app.example", "https://groblus.example/path"]) {
      expect((await worker.fetch(new Request("https://app.example/"), appEnv(site))).status).toBe(500);
    }
  });
});

describe("scheduled expiry cleanup", () => {
  it("removes expired invitations/receipts/rate rows and preserves active rows", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO invites VALUES ('expired',1,'2000-01-01T00:00:00Z'),('active',1,'2099-01-01T00:00:00Z')"),
      env.DB.prepare("INSERT INTO discord_interactions VALUES ('expired','2000-01-01T00:00:00Z'),('active','2099-01-01T00:00:00Z')"),
      env.DB.prepare("INSERT INTO rate_limits VALUES ('expired',1,1),('active',1,4070908800)"),
    ]);
    await worker.scheduled({} as ScheduledController, env);
    expect((await env.DB.prepare("SELECT code_hash FROM invites").all()).results).toEqual([{code_hash: "active"}]);
    expect((await env.DB.prepare("SELECT id FROM discord_interactions").all()).results).toEqual([{id: "active"}]);
    expect((await env.DB.prepare("SELECT key FROM rate_limits").all()).results).toEqual([{key: "active"}]);
  });
});
