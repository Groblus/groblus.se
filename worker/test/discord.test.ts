import { beforeAll, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { handleDiscord, verifyDiscord } from "../src/discord";
import type { Env } from "../src/types";
let keys: CryptoKeyPair,
  publicHex: string,
  sequence = 100;
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const hash = async (s: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const bindings = () =>
  ({
    ...env,
    DISCORD_PUBLIC_KEY: publicHex,
    DISCORD_GUILD_ID: "42",
  }) as unknown as Env;
async function request(
  payload: unknown,
  ts = String(Math.floor(Date.now() / 1000)),
) {
  const body = JSON.stringify(payload),
    signature = hex(
      await crypto.subtle.sign(
        "Ed25519",
        keys.privateKey,
        new TextEncoder().encode(ts + body),
      ),
    );
  return new Request("https://groblus.test/api/discord/interactions", {
    method: "POST",
    headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": ts },
    body,
  });
}
const interaction = (data: unknown, type = 2, discordId = "123") => ({
  id: String(sequence++),
  type,
  guild_id: "42",
  member: { user: { id: discordId } },
  data,
});
const command = (name: string, options: unknown[] = []) => ({
  name: "groblus",
  options: [{ name, options }],
});
async function call(payload: unknown) {
  return (
    await handleDiscord(await request(payload), bindings())
  ).json() as Promise<any>;
}
async function seed() {
  await env.DB.prepare("INSERT OR REPLACE INTO memberships VALUES (\'member@example.test\',2200,\'test\',\'fixture\')").run();
  await env.DB.prepare(
    "INSERT INTO users(id,display_name,discord_id,created_at,email) VALUES(?,?,?,?,\'member@example.test\')",
  )
    .bind("member", "Oliver", "123", new Date().toISOString())
    .run();
}
beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  publicHex = hex(await crypto.subtle.exportKey("raw", keys.publicKey));
});
describe("Discord trust boundary", () => {
  it("validates signatures and rejects tampering, stale and future timestamps", async () => {
    const valid = await request({ type: 1 });
    expect(
      await verifyDiscord(valid, await valid.clone().text(), publicHex),
    ).toBe(true);
    expect(await verifyDiscord(valid, '{"type":2}', publicHex)).toBe(false);
    const stale = await request(
      { type: 1 },
      String(Math.floor(Date.now() / 1000) - 301),
    );
    expect((await handleDiscord(stale, bindings())).status).toBe(401);
    const future = await request(
      { type: 1 },
      String(Math.floor(Date.now() / 1000) + 301),
    );
    expect((await handleDiscord(future, bindings())).status).toBe(401);
    expect(
      (
        await handleDiscord(
          new Request("https://test", { method: "POST", body: "{}" }),
          bindings(),
        )
      ).status,
    ).toBe(401);
    expect(await call({ type: 1 })).toEqual({ type: 1 });
  });
  it("rejects another guild and unregistered users with private responses", async () => {
    const other = interaction(command("profil"));
    other.guild_id = "99";
    const response = await call(other);
    expect(response.data.flags).toBe(64);
    expect(response.data.content).toContain("Groblus server");
    const response2 = await call(interaction(command("profil")));
    expect(response2.data.content).toContain("registrera");
    expect(response2.data.allowed_mentions.parse).toEqual([]);
  });
  it("updates independent interests in shared D1 and rejects replay", async () => {
    await seed();
    const payload = interaction({ custom_id: "g:play:the-warren" }, 3);
    expect((await call(payload)).data.flags).toBe(64);
    expect((await call(payload)).data.content).toContain("redan hanterats");
    await call(interaction({ custom_id: "g:gm:the-warren" }, 3));
    expect(
      await env.DB.prepare(
        "SELECT want_play,want_gm FROM interests WHERE user_id=? AND game_id=?",
      )
        .bind("member", "the-warren")
        .first(),
    ).toEqual({ want_play: 1, want_gm: 1 });
    await call(interaction({ custom_id: "g:play:the-warren" }, 3));
    expect(
      await env.DB.prepare(
        "SELECT want_play,want_gm FROM interests WHERE user_id=? AND game_id=?",
      )
        .bind("member", "the-warren")
        .first(),
    ).toEqual({ want_play: 0, want_gm: 1 });
  });
  it("keeps punctuation-only game names usable in Discord selects", async () => {
    await seed();
    await env.DB.prepare(
      "INSERT INTO games(id,name,normalized_name,kind,created_at) VALUES(?,?,?,?,?)",
    ).bind("symbols", "***", "***", "other", new Date().toISOString()).run();
    const response = await call(interaction(command("profil")));
    const options = response.data.components[0].components[0].options;
    expect(options.find((option: { value: string }) => option.value === "symbols").label)
      .toBe("***");
  });
  it("updates one weekly slot without erasing another and can unset it", async () => {
    await seed();
    await call(
      interaction({ custom_id: "a:set:0:evening", values: ["often"] }, 3),
    );
    await call(
      interaction({ custom_id: "a:set:5:day", values: ["sometimes"] }, 3),
    );
    expect(
      (
        await env.DB.prepare("SELECT * FROM availability WHERE user_id=?")
          .bind("member")
          .all()
      ).results,
    ).toHaveLength(2);
    await call(
      interaction({ custom_id: "a:set:0:evening", values: ["unset"] }, 3),
    );
    expect(
      await env.DB.prepare(
        "SELECT day,period,preference FROM availability WHERE user_id=?",
      )
        .bind("member")
        .first(),
    ).toEqual({ day: 5, period: "day", preference: "sometimes" });
  });
  it("directs registration through Access without creating an unverified profile", async () => {
    const result = await call(interaction(command("registrera")));
    expect(result.data.content).toContain("Cloudflare");
    expect((await env.DB.prepare("SELECT * FROM users").all()).results).toHaveLength(0);
  });
  it("links one code once and rejects conflicting profiles without consuming code", async () => {
    await env.DB.prepare("INSERT INTO memberships VALUES (\'member@example.test\',2200,\'test\',\'fixture\')").run();
    await env.DB.prepare(
      "INSERT INTO users(id,email,display_name,created_at) VALUES(?,?,?,?)",
    )
      .bind("web", "member@example.test", "Web", new Date().toISOString())
      .run();
    await env.DB.prepare("INSERT INTO discord_link_codes VALUES(?,?,?)")
      .bind(
        await hash("link"),
        "web",
        new Date(Date.now() + 60_000).toISOString(),
      )
      .run();
    const link = command("koppla", [{ name: "kod", value: "link" }]);
    expect((await call(interaction(link))).data.content).toContain("kopplade");
    expect((await call(interaction(link, 2, "456"))).data.content).toContain(
      "ogiltig",
    );
    expect(
      (
        await env.DB.prepare("SELECT discord_id FROM users WHERE id=?")
          .bind("web")
          .first()
      )?.discord_id,
    ).toBe("123");
    await env.DB.prepare("INSERT INTO discord_link_codes VALUES(?,?,?)")
      .bind(
        await hash("second"),
        "web",
        new Date(Date.now() + 60_000).toISOString(),
      )
      .run();
    expect(
      (
        await call(
          interaction(command("koppla", [{ name: "kod", value: "second" }])),
        )
      ).data.content,
    ).toContain("redan en profil");
    expect(
      (await env.DB.prepare("SELECT * FROM discord_link_codes").all()).results,
    ).toHaveLength(1);
  });
  it("shows only display names and aggregate common times privately", async () => {
    await seed();
    await call(interaction({ custom_id: "g:play:the-warren" }, 3));
    await call(
      interaction({ custom_id: "a:set:0:evening", values: ["often"] }, 3),
    );
    const people = await call(
      interaction({ custom_id: "g:people:the-warren" }, 3),
    );
    expect(people.data.content).toContain("Oliver");
    expect(people.data.flags).toBe(64);
    expect(people.data.content).not.toContain("123");
    const common = await call(
      interaction({ custom_id: "g:common:the-warren" }, 3),
    );
    expect(common.data.content).toContain("Mån 18–22: 1/0/0/0");
    expect(common.data.content).toContain("Mån 10–14: 0/0/0/1");
  });
  it("rejects expired linking codes without changing identities", async () => {
    await env.DB.prepare(
      "INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)",
    )
      .bind("web", "Web", new Date().toISOString())
      .run();
    await env.DB.prepare("INSERT INTO discord_link_codes VALUES(?,?,?)")
      .bind(
        await hash("old"),
        "web",
        new Date(Date.now() - 60_000).toISOString(),
      )
      .run();
    expect(
      (
        await call(
          interaction(command("koppla", [{ name: "kod", value: "old" }])),
        )
      ).data.content,
    ).toContain("ogiltig");
    expect(
      (
        await env.DB.prepare("SELECT discord_id FROM users WHERE id=?")
          .bind("web")
          .first()
      )?.discord_id,
    ).toBeNull();
  });
  it("records votes in shared plans, refuses mismatched plan options", async () => {
    await seed();
    await env.DB.prepare(
      "INSERT INTO plans VALUES('p','Spelkväll','the-warren','','member','proposed',NULL,?)",
    )
      .bind(new Date().toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO plan_options VALUES('o','p','2026-10-10T12:00:00Z','2026-10-10T18:00:00Z')",
    ).run();
    await call(interaction({ custom_id: "p:vote:p:o", values: ["yes"] }, 3));
    expect(
      (
        await env.DB.prepare(
          "SELECT vote FROM votes WHERE user_id=? AND option_id=?",
        )
          .bind("member", "o")
          .first()
      )?.vote,
    ).toBe("yes");
    await call(interaction({ custom_id: "p:vote:wrong:o", values: ["no"] }, 3));
    expect(
      (
        await env.DB.prepare(
          "SELECT vote FROM votes WHERE user_id=? AND option_id=?",
        )
          .bind("member", "o")
          .first()
      )?.vote,
    ).toBe("yes");
  });
});

it('blocks expired members on commands and component actions without altering interests', async () => {
  await seed();
  await call(interaction({custom_id:'g:play:the-warren'},3));
  await env.DB.prepare('UPDATE memberships SET paid_through_year=2000').run();
  for (const [data,type] of [[command('profil'),2],[{custom_id:'g:play:the-warren'},3]] as const) {
    expect((await call(interaction(data,type))).data.content).toContain('Medlemsavgiften');
  }
  expect(await env.DB.prepare("SELECT want_play FROM interests WHERE user_id='member' AND game_id='the-warren'").first()).toEqual({want_play:1});
});
