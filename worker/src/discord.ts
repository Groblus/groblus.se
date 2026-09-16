import { isPaid, membershipYear } from "./membership";
import type { Env } from "./types";
import { listGames, listPlans, setInterest, vote } from "./services";

type Interaction = {
  id: string;
  type: number;
  guild_id?: string;
  member?: { user?: { id: string; bot?: boolean } };
  data?: {
    name?: string;
    custom_id?: string;
    values?: string[];
    options?: Option[];
    components?: { components?: { custom_id: string; value: string }[] }[];
  };
};
type Option = { name: string; value?: string; options?: Option[] };
const days = [
  "Måndag",
  "Tisdag",
  "Onsdag",
  "Torsdag",
  "Fredag",
  "Lördag",
  "Söndag",
];
const periods = { day: "10–14", afternoon: "14–18", evening: "18–22" };
const preferences = {
  often: "Ofta",
  sometimes: "Ibland",
  rarely: "Sällan",
  unset: "Ej angivet",
};
const json = (body: unknown, status = 200) => Response.json(body, { status });
const reply = (content: string, components: unknown[] = []) =>
  json({
    type: 4,
    data: { content, flags: 64, allowed_mentions: { parse: [] }, components },
  });
const row = (...components: unknown[]) => ({ type: 1, components });
const button = (label: string, custom_id: string, active = false) => ({
  type: 2,
  label,
  custom_id,
  style: active ? 3 : 2,
});
const select = (custom_id: string, placeholder: string, options: unknown[]) =>
  row({ type: 3, custom_id, placeholder, options });
const safe = (value: unknown) =>
  String(value ?? "")
    .replace(/[@*_`~>|\\]/g, "")
    .slice(0, 90);
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const hex = (s: string) =>
  Uint8Array.from(s.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));

/** Verify the untouched request body before parsing or touching D1. */
export async function verifyDiscord(
  request: Request,
  body: string,
  key: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  const signature = request.headers.get("X-Signature-Ed25519") ?? "",
    timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
  if (
    !key ||
    !/^[a-f\d]{64}$/i.test(key) ||
    !/^[a-f\d]{128}$/i.test(signature) ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300_000
  )
    return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      hex(key),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      hex(signature),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

async function profile(env: Env, userId: string, page = 0): Promise<Response> {
  const games = await listGames(env.DB, userId);
  const start = Math.max(0, page) * 20,
    chunk = games.slice(start, start + 20);
  const components: unknown[] = [];
  if (chunk.length)
    components.push(
      select(
        "g:choose",
        "Välj ett spel",
        chunk.map((g) => ({
          // Select labels are plain text; stripping Markdown can make them empty.
          label: g.name.slice(0, 100),
          value: g.id,
          description: `${g.wantPlay ? "✓ Spela" : "Spela –"} · ${g.wantGm ? "✓ Spelleda" : "Spelleda –"}`,
        })),
      ),
    );
  const nav = [];
  if (start > 0) nav.push(button("Föregående", `g:page:${page - 1}`));
  if (games.length > start + 20)
    nav.push(button("Nästa", `g:page:${page + 1}`));
  if (nav.length) components.push(row(...nav));
  components.push(
    row(
      button("Lägg till spel", "g:new"),
      button("Vanliga tider", "a:home"),
      button("Spelplaner", "p:home"),
    ),
  );
  return reply(
    "📚 **Din spelhylla**\nVälj ett spel och markera spela och spelleda var för sig. Dina ändringar sparas direkt och syns även på hemsidan.",
    components,
  );
}
async function game(env: Env, userId: string, id: string): Promise<Response> {
  const g = (await listGames(env.DB, userId)).find((g) => g.id === id);
  if (!g) return reply("Spelet finns inte längre. Kör /groblus profil igen.");
  return reply(
    `**${safe(g.name)}**\nSpela: ${g.wantPlay ? "ja" : "ej valt"} · Spelleda: ${g.wantGm ? "ja" : "ej valt"}\n${g.playCount} vill spela · ${g.gmCount} vill spelleda`,
    [
      row(
        button(
          g.wantPlay ? "✓ Vill spela" : "Vill spela",
          `g:play:${id}`,
          !!g.wantPlay,
        ),
        button(
          g.wantGm ? "✓ Vill spelleda" : "Vill spelleda",
          `g:gm:${id}`,
          !!g.wantGm,
        ),
      ),
      row(
        button("Vilka vill spela?", `g:people:${id}`),
        button("Gemensamma tider", `g:common:${id}`),
        button("Alla spel", "g:home"),
      ),
    ],
  );
}
async function people(env: Env, gameId: string, page = 0): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT u.display_name name,i.want_play play,i.want_gm gm FROM interests i JOIN users u ON u.id=i.user_id WHERE i.game_id=? AND (i.want_play=1 OR i.want_gm=1) ORDER BY u.display_name,u.id",
  )
    .bind(gameId)
    .all<{ name: string; play: number; gm: number }>();
  const chunk = results.slice(page * 10, page * 10 + 10),
    nav = [];
  if (page > 0)
    nav.push(button("Föregående", `g:people:${gameId}:${page - 1}`));
  if (results.length > page * 10 + 10)
    nav.push(button("Nästa", `g:people:${gameId}:${page + 1}`));
  return reply(
    "**Intresserade**\n" +
      (chunk
        .map(
          (p) =>
            `${safe(p.name)} · ${[p.play ? "spela" : "", p.gm ? "spelleda" : ""].filter(Boolean).join(" och ")}`,
        )
        .join("\n") || "Ingen har angett intresse ännu."),
    nav.length ? [row(...nav)] : [],
  );
}
async function commonTimes(env: Env, gameId: string): Promise<Response> {
  const count = await env.DB.prepare(
    "SELECT COUNT(*) n FROM interests WHERE game_id=? AND (want_play=1 OR want_gm=1)",
  )
    .bind(gameId)
    .first<{ n: number }>();
  const { results } = await env.DB.prepare(
    "SELECT a.day,a.period,a.preference,COUNT(*) n FROM availability a JOIN interests i ON i.user_id=a.user_id WHERE i.game_id=? AND (i.want_play=1 OR i.want_gm=1) GROUP BY a.day,a.period,a.preference",
  )
    .bind(gameId)
    .all<{ day: number; period: string; preference: string; n: number }>();
  const lines = days.flatMap((day, d) =>
    Object.entries(periods).map(([period, time]) => {
      const matching = results.filter(
          (r) => r.day === d && r.period === period,
        ),
        n = (pref: string) =>
          matching.find((r) => r.preference === pref)?.n ?? 0;
      return `${day.slice(0, 3)} ${time}: ${n("often")}/${n("sometimes")}/${n("rarely")}/${(count?.n ?? 0) - matching.reduce((sum, r) => sum + r.n, 0)}`;
    }),
  );
  return reply(
    `**Gemensamma tider — ${count?.n ?? 0} intresserade**\nOfta / Ibland / Sällan / Ej angivet\n` +
      lines.join("\n") +
      "\nSvensk lokal tid. Detta är vanliga tider, inte svar på ett datumförslag.",
  );
}
async function availability(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT day,period,preference FROM availability WHERE user_id=? ORDER BY day,period",
  )
    .bind(userId)
    .all<{
      day: number;
      period: keyof typeof periods;
      preference: keyof typeof preferences;
    }>();
  return reply(
    "🗓️ **Dina vanliga tider** (svensk lokal tid)\n" +
      (results.length
        ? results
            .map(
              (s) =>
                `${days[s.day]} ${periods[s.period]}: ${preferences[s.preference]}`,
            )
            .join("\n")
        : "Inga tider angivna ännu.") +
      "\nEj angivet betyder okänt, inte att du är upptagen.",
    [
      select(
        "a:day",
        "Välj veckodag",
        days.map((label, i) => ({ label, value: String(i) })),
      ),
    ],
  );
}
async function plans(env: Env, userId: string, page = 0): Promise<Response> {
  const all = await listPlans(env.DB, userId),
    chunk = all.slice(page * 20, page * 20 + 20),
    components: unknown[] = [];
  if (chunk.length)
    components.push(
      select(
        "p:choose",
        "Välj en spelplan",
        chunk.map((p) => ({
          label: p.title.slice(0, 100),
          value: p.id,
          description:
            p.status === "confirmed" ? "Datum bekräftat" : "Datumförslag",
        })),
      ),
    );
  const nav = [];
  if (page > 0) nav.push(button("Föregående", `p:page:${page - 1}`));
  if (all.length > page * 20 + 20)
    nav.push(button("Nästa", `p:page:${page + 1}`));
  if (nav.length) components.push(row(...nav));
  return reply(
    "🎲 **Spelplaner**\n" +
      (all.length
        ? "Välj en plan för att svara på datumförslagen."
        : "Inga spelplaner ännu.") +
      " Skapa nya planer på hemsidan.",
    components,
  );
}
async function plan(env: Env, userId: string, id: string): Promise<Response> {
  const p = (await listPlans(env.DB, userId)).find((p) => p.id === id);
  if (!p) return reply("Planen finns inte längre.");
  const fmt = (s: string) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(s));
  return reply(
    `**${safe(p.title)}** · ${safe(p.gameName)}\n${p.status === "confirmed" ? "Datum bekräftat" : "Datumförslag"}\n` +
      p.options
        .map(
          (o, i) =>
            `${i + 1}. ${fmt(o.startsAt)} – ${fmt(o.endsAt)}${o.id === p.confirmedOptionId ? " ✓" : ""}\nJa ${o.yesCount} · Kanske ${o.maybeCount} · Nej ${o.noCount} · Ditt svar: ${o.myVote ?? "ej svarat"}`,
        )
        .join("\n"),
    [
      select(
        `p:option:${id}`,
        "Välj ett datum att svara på",
        p.options.map((o, i) => ({
          label: `${i + 1}. ${fmt(o.startsAt)}`,
          value: o.id,
        })),
      ),
    ],
  );
}

export async function handleDiscord(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (Number(request.headers.get("content-length") ?? 0) > 32_768)
    return json({ error: "Too large" }, 413);
  // Bound bytes while reading: Content-Length may be absent or untrusted.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0,
    body = "";
  try {
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32_768) {
          await reader.cancel().catch(() => {});
          return json({ error: "Too large" }, 413);
        }
        chunks.push(value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return json({ error: "Invalid request body" }, 400);
  } finally {
    reader?.releaseLock();
  }
  if (!(await verifyDiscord(request, body, env.DISCORD_PUBLIC_KEY)))
    return json({ error: "Invalid signature" }, 401);
  let i: Interaction;
  try {
    i = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (i.type === 1) return json({ type: 1 });
  if (!env.DISCORD_GUILD_ID || i.guild_id !== env.DISCORD_GUILD_ID)
    return reply("Spelhyllan är bara tillgänglig i Groblus server.");
  const discordId = i.member?.user?.id;
  if (
    !discordId ||
    i.member?.user?.bot ||
    !/^\d{1,25}$/.test(discordId) ||
    !/^\d{1,25}$/.test(i.id ?? "")
  )
    return reply("Kunde inte verifiera ditt konto.");
  // Persist receipts to reject authenticated replays, including repeat toggle requests.
  const receipt = await env.DB.prepare(
    "INSERT OR IGNORE INTO discord_interactions(id,expires_at) VALUES(?,?)",
  )
    .bind(i.id, new Date(Date.now() + 600_000).toISOString())
    .run();
  if (!receipt.meta.changes)
    return reply("Den här åtgärden har redan hanterats. Öppna /groblus igen.");
  await env.DB.prepare("DELETE FROM discord_interactions WHERE expires_at < ?")
    .bind(new Date().toISOString())
    .run();
  const sub = i.data?.options?.[0],
    command = i.type === 2 ? sub?.name : undefined;
  if (i.type === 2 && i.data?.name !== "groblus")
    return reply("Okänt kommando.");
  const option = (name: string) =>
    String(sub?.options?.find((o) => o.name === name)?.value ?? "").trim();
  let user = await env.DB.prepare("SELECT id,email FROM users WHERE discord_id=?")
    .bind(discordId)
    .first<{ id: string; email: string | null }>();
  try {
    if (command === "registrera") {
      return reply(`Logga in med din medlemsadress via Cloudflare på ${env.APP_ORIGIN}/spelhyllan/. Skapa sedan en kopplingskod i din profil och använd /groblus koppla. Du anger e-post och verifieringskod på webbplatsen, inte i Discord.`);
    }
    if (command === "koppla") {
      if (user)
        return reply(
          "Ditt Discord-konto har redan en profil. Kontakta föreningens administratör för att hantera dubbla profiler; vi slår inte ihop dem automatiskt.",
        );
      const code = option("kod");
      if (!code || code.length > 200)
        return reply("Koden är ogiltig eller har gått ut.");
      const digest = await hash(code),
        now = new Date().toISOString();
      const result = await env.DB.batch([
        env.DB.prepare(
          "UPDATE users SET discord_id=? WHERE discord_id IS NULL AND email IN (SELECT email FROM memberships WHERE paid_through_year>=?) AND id=(SELECT user_id FROM discord_link_codes WHERE code_hash=? AND expires_at>?)",
        ).bind(discordId, membershipYear(), digest, now),
        env.DB.prepare(
          "DELETE FROM discord_link_codes WHERE code_hash=? AND user_id IN (SELECT id FROM users WHERE discord_id=?)",
        ).bind(digest, discordId),
      ]);
      return reply(
        result[0].meta.changes
          ? "Kontona är kopplade. Samma spelhylla och tider finns nu här och på hemsidan."
          : "Koden är ogiltig, redan använd eller kontot är redan kopplat.",
      );
    }
    if (!user)
      return reply(
        "Välkommen! Använd /groblus registrera för att logga in med din medlemsadress och koppla Discord.",
      );
    if (!await isPaid(env, user.email)) return reply("Medlemsavgiften för innevarande år är inte registrerad. Kontakta kassören.");
    if (command === "profil") return profile(env, user.id);
    if (command === "tider") return availability(env, user.id);
    if (command === "planer") return plans(env, user.id);
    const parts = (i.data?.custom_id ?? "").split(":"),
      [area, action, a, b] = parts;
    const value = i.data?.values?.[0] ?? "";
    if (i.type === 3 && area === "g") {
      if (action === "home" || action === "page")
        return profile(
          env,
          user.id,
          action === "page" ? Math.min(10000, Math.max(0, Number(a) || 0)) : 0,
        );
      if (action === "choose") return game(env, user.id, value);
      if (action === "people")
        return people(env, a, Math.min(10000, Math.max(0, Number(b) || 0)));
      if (action === "common") return commonTimes(env, a);
      if (action === "play" || action === "gm") {
        const g = (await listGames(env.DB, user.id)).find((g) => g.id === a);
        if (!g) return reply("Spelet finns inte längre.");
        await setInterest(
          env.DB,
          user.id,
          a,
          action === "play" ? !g.wantPlay : !!g.wantPlay,
          action === "gm" ? !g.wantGm : !!g.wantGm,
        );
        return game(env, user.id, a);
      }
      if (action === "new")
        return reply("Vilken sorts spel?", [
          select("g:kind", "Välj speltyp", [
            { label: "Rollspel", value: "rpg" },
            { label: "Brädspel", value: "boardgame" },
            { label: "Annat", value: "other" },
          ]),
        ]);
      if (action === "kind" && ["rpg", "boardgame", "other"].includes(value))
        return json({
          type: 9,
          data: {
            custom_id: `g:create:${value}`,
            title: "Lägg till ett spel",
            components: [
              row({
                type: 4,
                custom_id: "name",
                label: "Spelets namn",
                style: 1,
                required: true,
                min_length: 1,
                max_length: 100,
              }),
            ],
          },
        });
    }
    if (i.type === 5 && area === "g" && action === "create") {
      const fields =
          i.data?.components?.flatMap((r) => r.components ?? []) ?? [],
        name = fields.find((f) => f.custom_id === "name")?.value.trim() ?? "",
        kind = a;
      if (
        !name ||
        name.length > 100 ||
        !["rpg", "boardgame", "other"].includes(kind)
      )
        return reply(
          "Ange ett spelnamn. Börja om med Lägg till spel om något gick fel.",
        );
      const normalized = name
        .normalize("NFKC")
        .toLocaleLowerCase("sv-SE")
        .replace(/\s+/g, " ")
        .trim();
      await env.DB.prepare(
        "INSERT OR IGNORE INTO games(id,name,normalized_name,kind,created_at) VALUES(?,?,?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          name,
          normalized,
          kind,
          new Date().toISOString(),
        )
        .run();
      return profile(env, user.id);
    }
    if (i.type === 3 && area === "a") {
      if (action === "home") return availability(env, user.id);
      if (action === "day" && /^[0-6]$/.test(value))
        return reply(days[Number(value)], [
          select(
            `a:period:${value}`,
            "Välj tid",
            Object.entries(periods).map(([v, label]) => ({ label, value: v })),
          ),
        ]);
      if (
        action === "period" &&
        /^[0-6]$/.test(a) &&
        Object.hasOwn(periods, value)
      )
        return reply(
          `${days[Number(a)]} ${periods[value as keyof typeof periods]}`,
          [
            select(
              `a:set:${a}:${value}`,
              "Hur ofta kan du?",
              Object.entries(preferences).map(([value, label]) => ({
                label,
                value,
              })),
            ),
          ],
        );
      if (
        action === "set" &&
        /^[0-6]$/.test(a) &&
        Object.hasOwn(periods, b) &&
        Object.hasOwn(preferences, value)
      ) {
        if (value === "unset")
          await env.DB.prepare(
            "DELETE FROM availability WHERE user_id=? AND day=? AND period=?",
          )
            .bind(user.id, Number(a), b)
            .run();
        else
          await env.DB.prepare(
            "INSERT INTO availability(user_id,day,period,preference) VALUES(?,?,?,?) ON CONFLICT(user_id,day,period) DO UPDATE SET preference=excluded.preference",
          )
            .bind(user.id, Number(a), b, value)
            .run();
        return availability(env, user.id);
      }
    }
    if (i.type === 3 && area === "p") {
      if (action === "home" || action === "page")
        return plans(
          env,
          user.id,
          Math.min(10000, Math.max(0, Number(a) || 0)),
        );
      if (action === "choose") return plan(env, user.id, value);
      if (action === "option")
        return reply("Kan du spela den här tiden?", [
          select(`p:vote:${a}:${value}`, "Ditt svar", [
            { label: "Ja", value: "yes" },
            { label: "Kanske", value: "maybe" },
            { label: "Nej", value: "no" },
            { label: "Ta bort mitt svar", value: "unset" },
          ]),
        ]);
      if (
        action === "vote" &&
        ["yes", "maybe", "no", "unset"].includes(value)
      ) {
        await vote(
          env.DB,
          user.id,
          a,
          b,
          value === "unset" ? null : (value as "yes" | "maybe" | "no"),
        );
        return plan(env, user.id, a);
      }
    }
    return reply(
      "Öppna /groblus profil, /groblus tider eller /groblus planer för att börja.",
    );
  } catch {
    return reply(
      "Det gick inte att spara ändringen. Försök igen eller kontakta föreningens administratör.",
    );
  }
}
