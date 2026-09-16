import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";
import { accessBindings, accessToken, setupAccess } from "./access-fixture";
import type { Env } from "../src/types";

// Exercise both public HTTP surfaces against one real, isolated D1 database.
// Keys and guild IDs exist only in this test; no Discord network call is made.
let keys: CryptoKeyPair;
let bindings: Env;
let sequence = 9000;
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

beforeAll(async () => {
  await setupAccess();
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  bindings = {
    ...env,
    ...accessBindings,
    APP_ORIGIN: "http://localhost:8787",
    DISCORD_PUBLIC_KEY: hex(
      await crypto.subtle.exportKey("raw", keys.publicKey),
    ),
    DISCORD_GUILD_ID: "42",
  };
});

async function web(path: string, cookie = "", method = "GET", data?: unknown) {
  const response = await worker.fetch(
    new Request(`http://localhost:8787/api${path}`, {
      method,
      headers: {
        Origin: "http://localhost:8787",
        "Content-Type": "application/json",
        "Cf-Access-Jwt-Assertion": cookie,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    bindings,
  );
  expect(response.status).toBe(
    path === "/plans" && method === "POST" ? 201 : 200,
  );
  return {
    data: await response.json<any>(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function discord(data: unknown, type = 3) {
  const body = JSON.stringify({
    id: String(sequence++),
    type,
    guild_id: "42",
    member: { user: { id: "123" } },
    data,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = hex(
    await crypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      new TextEncoder().encode(timestamp + body),
    ),
  );
  const response = await worker.fetch(
    new Request("http://localhost:8787/api/discord/interactions", {
      method: "POST",
      body,
      headers: {
        "X-Signature-Ed25519": signature,
        "X-Signature-Timestamp": timestamp,
      },
    }),
    bindings,
  );
  expect(response.status).toBe(200);
  const payload = await response.json<any>();
  expect(payload.data.flags).toBe(64);
  expect(payload.data.allowed_mentions.parse).toEqual([]);
  return payload.data;
}

async function linkedMember() {
  await env.DB.prepare("INSERT OR REPLACE INTO memberships VALUES (?,2200,?,?)").bind("cross-surface@example.invalid", "test", "fixture").run();
  const cookie = await accessToken("cross-surface@example.invalid");
  const registered = await web("/me", cookie);
  const code = (await web("/discord/link-code", cookie, "POST", {})).data.code;
  const linked = await discord(
    {
      name: "groblus",
      options: [{ name: "koppla", options: [{ name: "kod", value: code }] }],
    },
    2,
  );
  expect(linked.content).toContain("kopplade");
  expect((await web("/me", cookie)).data.user).toMatchObject({
    id: registered.data.user.id,
    discordLinked: true,
  });
  return cookie;
}

describe("linked website and signed Discord share member state", () => {
  it("reflects website interests in Discord and independent Discord toggles on the website", async () => {
    const cookie = await linkedMember();
    await web("/interests/the-warren", cookie, "PUT", {
      wantPlay: true,
      wantGm: false,
    });
    const detail = await discord({
      custom_id: "g:choose",
      values: ["the-warren"],
    });
    expect(detail.content).toContain("Spela: ja · Spelleda: ej valt");
    expect(detail.content).toContain("1 vill spela · 0 vill spelleda");
    await discord({ custom_id: "g:gm:the-warren" });
    let game = (await web("/games", cookie)).data.games.find(
      (g: any) => g.id === "the-warren",
    );
    expect(game).toMatchObject({
      wantPlay: true,
      wantGm: true,
      playCount: 1,
      gmCount: 1,
    });
    await discord({ custom_id: "g:play:the-warren" });
    game = (await web("/games", cookie)).data.games.find(
      (g: any) => g.id === "the-warren",
    );
    expect(game).toMatchObject({
      wantPlay: false,
      wantGm: true,
      playCount: 0,
      gmCount: 1,
    });
  }, 60000);

  it("reflects website availability in Discord and Discord edits/removal without erasing other website slots", async () => {
    const cookie = await linkedMember();
    await web("/availability", cookie, "PUT", {
      slots: [
        { day: 0, period: "evening", preference: "often" },
        { day: 5, period: "afternoon", preference: "sometimes" },
      ],
    });
    const detail = await discord({ custom_id: "a:home" });
    expect(detail.content).toContain("Måndag 18–22: Ofta");
    expect(detail.content).toContain("Lördag 14–18: Ibland");
    await discord({ custom_id: "a:set:5:afternoon", values: ["often"] });
    expect((await web("/availability", cookie)).data.slots).toEqual(
      expect.arrayContaining([
        { day: 0, period: "evening", preference: "often" },
        { day: 5, period: "afternoon", preference: "often" },
      ]),
    );
    await discord({ custom_id: "a:set:0:evening", values: ["unset"] });
    expect((await web("/availability", cookie)).data.slots).toEqual([
      { day: 5, period: "afternoon", preference: "often" },
    ]);
  }, 60000);

  it("reflects website-created plans/votes in Discord, Discord votes on website, and website date confirmation in Discord", async () => {
    const cookie = await linkedMember();
    const created = await web("/plans", cookie, "POST", {
      title: "Cross-surface test plan",
      gameId: "the-warren",
      description: "Test-only plan",
      options: [
        { startsAt: "2098-10-10T12:00:00Z", endsAt: "2098-10-10T18:00:00Z" },
        { startsAt: "2098-10-11T12:00:00Z", endsAt: "2098-10-11T18:00:00Z" },
      ],
    });
    const id = created.data.id;
    const first = (await web("/plans", cookie)).data.plans.find(
      (p: any) => p.id === id,
    ).options[0].id;
    await web(`/plans/${id}/votes/${first}`, cookie, "PUT", { vote: "yes" });
    const detail = await discord({ custom_id: "p:choose", values: [id] });
    expect(detail.content).toContain("Cross-surface test plan");
    expect(detail.content).toContain(
      "Ja 1 · Kanske 0 · Nej 0 · Ditt svar: yes",
    );
    await discord({ custom_id: `p:vote:${id}:${first}`, values: ["maybe"] });
    let option = (await web("/plans", cookie)).data.plans
      .find((p: any) => p.id === id)
      .options.find((o: any) => o.id === first);
    expect(option).toMatchObject({
      myVote: "maybe",
      yesCount: 0,
      maybeCount: 1,
      noCount: 0,
    });
    await discord({ custom_id: `p:vote:${id}:${first}`, values: ["unset"] });
    option = (await web("/plans", cookie)).data.plans
      .find((p: any) => p.id === id)
      .options.find((o: any) => o.id === first);
    expect(option).toMatchObject({
      myVote: null,
      yesCount: 0,
      maybeCount: 0,
      noCount: 0,
    });
    await web(`/plans/${id}/confirm`, cookie, "POST", { optionId: first });
    const confirmed = await discord({ custom_id: "p:choose", values: [id] });
    expect(confirmed.content).toContain("Datum bekräftat");
    expect(confirmed.content).toContain("✓");
    expect(confirmed.content).toContain("Ditt svar: ej svarat");
  }, 60000);
});
