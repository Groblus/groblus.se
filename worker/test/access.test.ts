import { beforeAll, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";
import { accessBindings, accessToken, setupAccess } from "./access-fixture";
beforeAll(setupAccess);
const origin = "http://localhost:8787";
const call = (headers: Record<string,string> = {}, path = "/me", method = "GET", data?: unknown) => worker.fetch(new Request(origin + "/api" + path, {
  method, headers: {Origin: origin, "Content-Type": "application/json", ...headers},
  body: data === undefined ? undefined : JSON.stringify(data),
}), {...env, ...accessBindings});
it("accepts only signed Access identity for correct issuer, audience and expiry", async () => {
  for (const overrides of [{iss: "https://attacker.cloudflareaccess.com"}, {aud: "different-app"}, {exp: 1}]) {
    expect((await call({"Cf-Access-Jwt-Assertion": await accessToken("member@example.se", overrides)})).status).toBe(401);
  }
  const valid = await accessToken("member@example.se");
  const parts = valid.split(".");
  const tampered = parts[0] + "." + btoa(JSON.stringify({email: "attacker@example.se"})) + "." + parts[2];
  for (const headers of [{}, {"Cf-Access-Authenticated-User-Email": "member@example.se"}, {Cookie: "groblus_session=" + "a".repeat(64)}, {"Cf-Access-Jwt-Assertion": tampered}])
    expect((await call(headers as Record<string,string>)).status).toBe(401);
  expect((await env.DB.prepare("SELECT * FROM users").all()).results).toHaveLength(0);
  const response = await call({"Cf-Access-Jwt-Assertion": valid});
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect((await response.json<any>()).user).toMatchObject({email: "member@example.se", displayName: "", needsDisplayName: true});
});
it("keeps existing preferences; concurrent first visits create one member", async () => {
  await env.DB.prepare("INSERT INTO users(id,email,display_name,created_at) VALUES('existing','member@example.se','Member','2026-01-01')").run();
  await env.DB.prepare("INSERT INTO interests VALUES('existing','the-warren',1,1,'2026-01-01')").run();
  const response = await call({"Cf-Access-Jwt-Assertion": await accessToken("MEMBER@example.se")});
  expect((await response.json<any>()).user).toMatchObject({id: "existing", displayName: "Member", needsDisplayName: false});
  const next = await accessToken("new@example.se");
  const replies = await Promise.all([call({"Cf-Access-Jwt-Assertion": next}), call({"Cf-Access-Jwt-Assertion": next})]);
  expect(replies.map(r => r.status)).toEqual([200,200]);
  expect((await env.DB.prepare("SELECT * FROM users").all()).results).toHaveLength(2);
  expect((await env.DB.prepare("SELECT * FROM interests").all()).results).toHaveLength(1);
});
it("edits only name, enforces CSRF, retires all password and session routes", async () => {
  const headers = {"Cf-Access-Jwt-Assertion": await accessToken("member@example.se")};
  for (const displayName of ["", " ", "x".repeat(81)])
    expect((await call(headers, "/me", "PUT", {displayName})).status).toBe(400);
  const updated = await call(headers, "/me", "PUT", {displayName: " Member ", email: "other@example.se"});
  expect((await updated.json<any>()).user).toMatchObject({email: "member@example.se", displayName: "Member", needsDisplayName: false});
  expect((await call({...headers, Origin: "https://evil.example"}, "/me", "PUT", {displayName: "Other"})).status).toBe(403);
  for (const path of ["login", "register", "password", "reset", "logout"]) {
    const result = await call(headers, "/auth/" + path, "POST", {password: "obsolete-password"});
    expect(result.status).toBe(410);
    expect(result.headers.get("set-cookie")).toBeNull();
  }
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r=>r.name);
  expect(tables).not.toContain("sessions");
  expect(tables).not.toContain("recovery_codes");
  expect((await env.DB.prepare("PRAGMA table_info(users)").all()).results.map(r=>r.name)).not.toContain("password_hash");
});
it("fails closed without Access configuration", async () => {
  const request = new Request(origin + "/api/me", {headers: {"Cf-Access-Jwt-Assertion": await accessToken("member@example.se")}});
  expect((await worker.fetch(request, {...env, ACCESS_AUD: undefined, ACCESS_TEAM_DOMAIN: undefined})).status).toBe(401);
});
it("migration deletes old credentials while preserving member relationships", async () => {
  // Reconstruct only the retired schema elements, then apply the actual migration
  // to a member with existing interests. This database is isolated to this file.
  await env.DB.exec("ALTER TABLE users ADD COLUMN password_hash TEXT; CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at TEXT); CREATE TABLE recovery_codes(code_hash TEXT,user_id TEXT,expires_at TEXT);");
  await env.DB.prepare("INSERT INTO users(id,email,display_name,created_at,password_hash) VALUES('legacy','legacy@example.se','Legacy member','2026-01-01','legacy-hash')").run();
  await env.DB.prepare("INSERT INTO interests VALUES('legacy','the-warren',1,1,'2026-01-01')").run();
  await env.DB.prepare("INSERT INTO availability VALUES('legacy',5,'afternoon','often')").run();
  await env.DB.exec("INSERT INTO sessions VALUES('session-secret','legacy','2099-01-01'); INSERT INTO recovery_codes VALUES('recovery-secret','legacy','2099-01-01');");
  const migration = env.TEST_MIGRATIONS.find(m => m.name.includes("cloudflare_access"))!;
  await env.DB.batch(migration.queries.map(query => env.DB.prepare(query)));
  const member = await env.DB.prepare("SELECT * FROM users WHERE id='legacy'").first();
  expect(member).toMatchObject({display_name: "Legacy member", email: "legacy@example.se"});
  expect(member).not.toHaveProperty("password_hash");
  expect((await env.DB.prepare("SELECT * FROM interests WHERE user_id='legacy'").all()).results).toHaveLength(1);
  expect((await env.DB.prepare("SELECT * FROM availability WHERE user_id='legacy'").all()).results).toHaveLength(1);
});
it("bounds broken request streams without exposing transport details", async () => {
  const assertion = await accessToken("member@example.se");
  const body = new ReadableStream<Uint8Array>({start(controller) {controller.error(new Error("private transport details"));}});
  const request = new Request(origin + "/api/me", {method: "PUT", headers: {Origin: origin, "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": assertion}, body});
  const result = await worker.fetch(request, {...env, ...accessBindings});
  expect(result.status).toBe(400);
  expect(await result.text()).not.toContain("private transport");
});
