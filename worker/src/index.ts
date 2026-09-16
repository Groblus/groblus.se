import type { Env, User } from "./types";
import { digest, token, accessIdentity } from "./auth";
import {
  ApiError,
  listGames,
  listPlans,
  setInterest,
  setAvailability,
  vote,
} from "./services";
import { handleDiscord } from "./discord";
import { isAdmin, isPaid, membershipYear, parseImport } from './membership';
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  displayName: u.display_name,
  discordLinked: !!u.discord_id,
  needsDisplayName: !u.display_name.trim(),
});
const text = (v: unknown, min: number, max: number) => {
  if (typeof v !== "string" || v.trim().length < min || v.length > max)
    throw new ApiError(400, "Kontrollera de angivna uppgifterna.");
  return v.trim();
};
async function body(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "JSON krävs.");
  const reader = req.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) {
          await reader.cancel();
          throw new ApiError(413, "För stor förfrågan.");
        }
        chunks.push(value);
      }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Kunde inte läsa förfrågan.");
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw 0;
    return result;
  } catch {
    throw new ApiError(400, "Ogiltig JSON.");
  }
}
async function rate(env: Env, key: string, limit: number) {
  const now = Math.floor(Date.now() / 1000),
    expiry = now + 900;
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count",
  )
    .bind(await digest(key), expiry, now, now)
    .first<{ count: number }>();
  if (row && row.count > limit)
    throw new ApiError(429, "För många försök. Vänta 15 minuter.");
}
async function current(req: Request, env: Env) {
  const identity = await accessIdentity(req, env);
  if (!identity) return null;
  // Access verifies email ownership and the application allowlist. This table
  // stores member preferences only; Cloudflare owns authentication and sessions.
  await env.DB.prepare(
    "INSERT INTO users(id,email,display_name,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING",
  ).bind(crypto.randomUUID(), identity.email, "", new Date().toISOString()).run();
  return env.DB.prepare("SELECT * FROM users WHERE email=?")
    .bind(identity.email).first<User>();
}
async function api(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url),
    path = url.pathname.replace(/^\/api/, "");
  if (path === "/discord/interactions") return handleDiscord(req, env);
  if (!["GET", "HEAD"].includes(req.method)) {
    if (
      req.headers.get("origin") !== env.APP_ORIGIN ||
      url.origin !== env.APP_ORIGIN
    )
      throw new ApiError(403, "Otillåtet ursprung.");
    await rate(
      env,
      `ip:${req.headers.get("CF-Connecting-IP") ?? "local"}`,
      200,
    );
  }
  if (path.startsWith("/auth/"))
    throw new ApiError(410, "Inloggningen sköts nu av Cloudflare Access.");
  const u = await current(req, env);
  if (!u) throw new ApiError(401, "Logga in via Cloudflare Access.");
  if (path === "/me" && req.method === "GET")
    return json({ user: { ...publicUser(u), isAdmin: isAdmin(env, u.email), isPaid: await isPaid(env, u.email) } });
  if (path.startsWith('/admin/')) {
    if (!isAdmin(env, u.email)) throw new ApiError(403, 'Endast administratörer har tillgång.');
    if (path === '/admin/members' && req.method === 'GET') {
      const members = await env.DB.prepare('SELECT m.email,m.paid_through_year paidThroughYear,u.discord_id discordId FROM memberships m LEFT JOIN users u ON lower(u.email)=lower(m.email) ORDER BY m.email').all();
      return json({ members: members.results, year: membershipYear() });
    }
    if (path === '/admin/members/revoke' && req.method === 'POST') {
      const email = text((await body(req)).email, 3, 254).toLowerCase();
      await env.DB.prepare('UPDATE memberships SET paid_through_year=?,updated_at=?,updated_by=? WHERE email=?').bind(membershipYear()-1, new Date().toISOString(), u.email, email).run();
      return json({ ok: true });
    }
    if (['/admin/members/preview', '/admin/members/import'].includes(path) && req.method === 'POST') {
      const b = await body(req);
      const parsed = parseImport(b.emails, b.year);
      if (path.endsWith('/preview')) return json(parsed);
      if (parsed.invalid.length) throw new ApiError(400, 'Rätta ogiltiga adresser innan du sparar.');
      await env.DB.batch(parsed.emails.map(email => env.DB.prepare('INSERT INTO memberships VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET paid_through_year=MAX(memberships.paid_through_year,excluded.paid_through_year),updated_at=excluded.updated_at,updated_by=excluded.updated_by').bind(email, parsed.year, new Date().toISOString(), u.email)));
      return json({ count: parsed.emails.length });
    }
    throw new ApiError(404, 'Sidan finns inte.');
  }
  if (path === "/me" && req.method === "PUT") {
    const name = text((await body(req)).displayName, 1, 80);
    await env.DB.prepare("UPDATE users SET display_name=? WHERE id=?")
      .bind(name, u.id).run();
    return json({ user: publicUser({ ...u, display_name: name }) });
  }
  if (!await isPaid(env, u.email)) throw new ApiError(403, 'Medlemsavgiften för innevarande år är inte registrerad. Kontakta kassören.');
  if (path === "/games" && req.method === "GET")
    return json({ games: await listGames(env.DB, u.id) });
  const players = path.match(/^\/games\/([^/]+)\/players$/);
  if (players && req.method === "GET")
    return json({
      players: (
        await env.DB.prepare(
          "SELECT u.id,u.display_name displayName,i.want_play wantPlay,i.want_gm wantGm FROM interests i JOIN users u ON u.id=i.user_id WHERE i.game_id=? AND (i.want_play=1 OR i.want_gm=1) ORDER BY u.display_name",
        )
          .bind(players[1])
          .all()
      ).results.map((p) => ({
        ...p,
        wantPlay: !!p.wantPlay,
        wantGm: !!p.wantGm,
      })),
    });
  const common = path.match(/^\/games\/([^/]+)\/availability$/);
  if (common && req.method === "GET") {
    const people = (
      await env.DB.prepare(
        "SELECT user_id FROM interests WHERE game_id=? AND (want_play=1 OR want_gm=1)",
      )
        .bind(common[1])
        .all()
    ).results;
    const rows = (
      await env.DB.prepare(
        "SELECT a.day,a.period,a.preference,COUNT(*) n FROM availability a JOIN interests i ON i.user_id=a.user_id WHERE i.game_id=? AND (i.want_play=1 OR i.want_gm=1) GROUP BY a.day,a.period,a.preference",
      )
        .bind(common[1])
        .all()
    ).results;
    return json({
      interestedCount: people.length,
      slots: Array.from({ length: 7 }, (_, day) =>
        ["day", "afternoon", "evening"].map((period) => {
          const counts = { oftenCount: 0, sometimesCount: 0, rarelyCount: 0 };
          for (const r of rows.filter(
            (r) => r.day === day && r.period === period,
          ))
            counts[`${r.preference}Count` as keyof typeof counts] = Number(r.n);
          return {
            day,
            period,
            ...counts,
            unsetCount:
              people.length -
              counts.oftenCount -
              counts.sometimesCount -
              counts.rarelyCount,
          };
        }),
      ).flat(),
    });
  }
  if (path === "/games" && req.method === "POST") {
    const b = await body(req),
      name = text(b.name, 1, 100);
    if (!["rpg", "boardgame", "other"].includes(b.kind))
      throw new ApiError(400, "Ogiltig speltyp.");
    const normalized = name
      .normalize("NFKC")
      .toLocaleLowerCase("sv")
      .replace(/\s+/g, " ");
    await env.DB.prepare(
      "INSERT INTO games VALUES (?,?,?,?,?) ON CONFLICT(normalized_name) DO NOTHING",
    )
      .bind(
        crypto.randomUUID(),
        name,
        normalized,
        b.kind,
        new Date().toISOString(),
      )
      .run();
    return json({
      game: await env.DB.prepare(
        "SELECT id,name,kind FROM games WHERE normalized_name=?",
      )
        .bind(normalized)
        .first(),
    });
  }
  const interest = path.match(/^\/interests\/([^/]+)$/);
  if (interest && req.method === "PUT") {
    const b = await body(req);
    await setInterest(env.DB, u.id, interest[1], b.wantPlay, b.wantGm);
    return json({ ok: true });
  }
  if (path === "/availability" && req.method === "GET")
    return json({
      slots: (
        await env.DB.prepare(
          "SELECT day,period,preference FROM availability WHERE user_id=? ORDER BY day,period",
        )
          .bind(u.id)
          .all()
      ).results,
    });
  if (path === "/availability" && req.method === "PUT") {
    await setAvailability(env.DB, u.id, (await body(req)).slots);
    return json({ ok: true });
  }
  if (path === "/plans" && req.method === "GET")
    return json({ plans: await listPlans(env.DB, u.id) });
  if (path === "/plans" && req.method === "POST") {
    const b = await body(req),
      title = text(b.title, 1, 120),
      description =
        typeof b.description === "string" && b.description.length <= 2000
          ? b.description.trim()
          : "";
    if (
      b.description !== undefined &&
      (typeof b.description !== "string" || b.description.length > 2000)
    )
      throw new ApiError(400, "Beskrivningen får ha högst 2000 tecken.");
    if (
      !(await env.DB.prepare("SELECT id FROM games WHERE id=?")
        .bind(text(b.gameId, 1, 100))
        .first())
    )
      throw new ApiError(400, "Välj ett spel.");
    if (
      !Array.isArray(b.options) ||
      b.options.length < 2 ||
      b.options.length > 5
    )
      throw new ApiError(400, "Ange 2–5 datumförslag.");
    const opts = b.options.map((o: { startsAt: unknown; endsAt: unknown }) => {
      if (!o || typeof o !== "object")
        throw new ApiError(400, "Ogiltigt datumförslag.");
      const startText = text(o.startsAt, 20, 40),
        endText = text(o.endsAt, 20, 40);
      if (
        ![startText, endText].every((t) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
            t,
          ),
        )
      )
        throw new ApiError(400, "Datum måste ha tidszon.");
      const start = new Date(startText),
        end = new Date(endText);
      if (
        !Number.isFinite(+start) ||
        !Number.isFinite(+end) ||
        +start <= Date.now() ||
        +end <= +start ||
        +end - +start > 86400000
      )
        throw new ApiError(
          400,
          "Datum måste ligga framåt och omfatta högst ett dygn.",
        );
      return {
        id: crypto.randomUUID(),
        start: start.toISOString(),
        end: end.toISOString(),
      };
    });
    if (
      new Set(opts.map((o: { start: string }) => o.start)).size !== opts.length
    )
      throw new ApiError(400, "Datumförslagen måste vara olika.");
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO plans(id,title,game_id,description,creator_id,status,created_at) VALUES (?,?,?,?,?,?,?)",
      ).bind(
        id,
        title,
        b.gameId,
        description,
        u.id,
        "proposed",
        new Date().toISOString(),
      ),
      ...opts.map((o: { id: string; start: string; end: string }) =>
        env.DB.prepare("INSERT INTO plan_options VALUES (?,?,?,?)").bind(
          o.id,
          id,
          o.start,
          o.end,
        ),
      ),
    ]);
    return json({ id }, 201);
  }
  const votes = path.match(/^\/plans\/([^/]+)\/votes\/([^/]+)$/);
  if (votes && req.method === "PUT") {
    await vote(env.DB, u.id, votes[1], votes[2], (await body(req)).vote);
    return json({ ok: true });
  }
  const confirm = path.match(/^\/plans\/([^/]+)\/confirm$/);
  if (confirm && req.method === "POST") {
    const b = await body(req),
      optionId = text(b.optionId, 1, 100);
    const result = await env.DB.prepare(
      "UPDATE plans SET status='confirmed',confirmed_option_id=? WHERE id=? AND creator_id=? AND status='proposed' AND EXISTS(SELECT 1 FROM plan_options WHERE id=? AND plan_id=plans.id)",
    )
      .bind(optionId, confirm[1], u.id, optionId)
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        403,
        "Bara skaparen kan bekräfta ett giltigt datumförslag.",
      );
    return json({ ok: true });
  }
  if (path === "/discord/link-code" && req.method === "POST") {
    if (u.discord_id) throw new ApiError(409, "Kontot är redan kopplat.");
    const code = token().slice(0, 24),
      expiresAt = new Date(Date.now() + 600000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM discord_link_codes WHERE user_id=?").bind(
        u.id,
      ),
      env.DB.prepare("INSERT INTO discord_link_codes VALUES (?,?,?)").bind(
        await digest(code),
        u.id,
        expiresAt,
      ),
    ]);
    return json({ code, expiresAt });
  }
  throw new ApiError(404, "Sidan finns inte.");
}
export default {
  async scheduled(_event: ScheduledController, env: Env) {
    const now = new Date().toISOString();
    await env.DB.batch(
      [
        "invites",
        "discord_link_codes",
        "discord_interactions",
      ]
        .map((table) =>
          env.DB.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).bind(now),
        )
        .concat([
          env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<=?").bind(
            Math.floor(Date.now() / 1000),
          ),
        ]),
    );
  },
  async fetch(req: Request, env: Env) {
    try {
      if (new URL(req.url).pathname.startsWith("/api/"))
        return await api(req, env);
      const url = new URL(req.url);
      if (env.SITE_ORIGIN && url.pathname !== "/spelhyllan" && !url.pathname.startsWith("/spelhyllan/")) {
        const site = new URL(env.SITE_ORIGIN);
        if (site.protocol !== "https:" || site.origin !== env.SITE_ORIGIN || site.origin === url.origin)
          throw new Error("Invalid SITE_ORIGIN");
        if (req.method !== "GET" && req.method !== "HEAD")
          return new Response("Not found", { status: 404 });
        site.pathname = url.pathname;
        site.search = url.search;
        return Response.redirect(site.toString(), 302);
      }
      return env.ASSETS
        ? env.ASSETS.fetch(req)
        : new Response("Not found", { status: 404 });
    } catch (e) {
      if (req.body && !req.body.locked) await req.body.cancel().catch(() => {});
      if (e instanceof ApiError) return json({ error: e.message }, e.status);
      console.error("Request failed", e instanceof Error ? e.name : "unknown");
      return json({ error: "Något gick fel. Försök igen." }, 500);
    }
  },
};
