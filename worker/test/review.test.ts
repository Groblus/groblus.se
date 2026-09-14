import { it, expect } from "vitest";
import { env } from "cloudflare:workers";
it("does not withdraw a vote after a plan is concurrently confirmed", async () => {
  await env.DB.prepare("INSERT INTO users(id,email,display_name,created_at) VALUES('u','member@example.se','Member',?)").bind(new Date().toISOString()).run();
  await env.DB.prepare(
    "INSERT INTO plans VALUES('p','Spelkväll','the-warren','','u','proposed',NULL,?)",
  )
    .bind(new Date().toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO plan_options VALUES('o','p','2026-10-10T12:00:00Z','2026-10-10T18:00:00Z')",
  ).run();
  await env.DB.prepare("INSERT INTO votes VALUES('u','o','yes')").run();
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare")
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (!sql.startsWith("DELETE FROM votes")) return stmt;
          return {
            bind: (...values: unknown[]) => ({
              run: async () => {
                await env.DB.prepare(
                  "UPDATE plans SET status='confirmed',confirmed_option_id='o' WHERE id='p'",
                ).run();
                return stmt.bind(...values).run();
              },
            }),
          };
        };
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const { vote } = await import("../src/services");
  await vote(db, "u", "p", "o", null);
  expect(
    (
      await env.DB.prepare(
        "SELECT vote FROM votes WHERE user_id='u' AND option_id='o'",
      ).first()
    )?.vote,
  ).toBe("yes");
});
