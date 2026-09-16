import { env } from "cloudflare:workers";
import { beforeAll, describe, it, expect } from "vitest";
import worker from "../src/index";
import { digest } from "../src/auth";
import { accessBindings, accessToken, setupAccess } from "./access-fixture";
beforeAll(setupAccess);
const call = async (path: string, method = "GET", data?: unknown, assertion = "") => worker.fetch(
  new Request(`http://localhost:8787/api${path}`, {
    method,
    headers: { Origin: "http://localhost:8787", "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": assertion },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), { ...env, ...accessBindings });
async function register(email: string, _unused?: string) {
  await env.DB.prepare("INSERT OR REPLACE INTO memberships VALUES (?,2200,?,?)").bind(email, "test", "fixture").run();
  const cookie = await accessToken(email);
  const response = await call("/me", "GET", undefined, cookie);
  expect(response.status).toBe(200);
  const updated = await call("/me", "PUT", {displayName: email}, cookie);
  return {cookie, user: (await updated.json<any>()).user};
}
describe("real D1 API with Cloudflare Access", () => {
  it("shares interests and availability, scopes votes, restricts confirmation", async () => {
    const a = await register("one@example.se", "invite-one-123"),
      b = await register("two@example.se", "invite-two-123");
    await call(
      "/interests/the-warren",
      "PUT",
      { wantPlay: true, wantGm: true },
      a.cookie,
    );
    await call(
      "/availability",
      "PUT",
      { slots: [{ day: 5, period: "afternoon", preference: "often" }] },
      a.cookie,
    );
    const games = await (
      await call("/games", "GET", undefined, b.cookie)
    ).json<any>();
    expect(games.games.find((g: any) => g.id === "the-warren")).toMatchObject({
      playCount: 1,
      gmCount: 1,
      wantPlay: false,
    });
    expect(
      (
        await (
          await call("/games/the-warren/players", "GET", undefined, b.cookie)
        ).json<any>()
      ).players[0].displayName,
    ).toBe("one@example.se");
    const common = await (
      await call("/games/the-warren/availability", "GET", undefined, b.cookie)
    ).json<any>();
    expect(
      common.slots.find((s: any) => s.day === 5 && s.period === "afternoon")
        .oftenCount,
    ).toBe(1);
    expect(
      (
        await (
          await call("/availability", "GET", undefined, b.cookie)
        ).json<any>()
      ).slots,
    ).toEqual([]);
    const plan = await (
      await call(
        "/plans",
        "POST",
        {
          title: "Play",
          gameId: "the-warren",
          description: "Test",
          options: [
            {
              startsAt: "2098-10-10T12:00:00Z",
              endsAt: "2098-10-10T18:00:00Z",
            },
            {
              startsAt: "2098-10-11T12:00:00Z",
              endsAt: "2098-10-11T18:00:00Z",
            },
          ],
        },
        a.cookie,
      )
    ).json<any>();
    const list = await (
        await call("/plans", "GET", undefined, b.cookie)
      ).json<any>(),
      option = list.plans[0].options[0].id;
    expect(
      (
        await call(
          `/plans/wrong/votes/${option}`,
          "PUT",
          { vote: "yes" },
          b.cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          `/plans/${plan.id}/votes/${option}`,
          "PUT",
          { vote: "yes" },
          b.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          `/plans/${plan.id}/confirm`,
          "POST",
          { optionId: option },
          b.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `/plans/${plan.id}/confirm`,
          "POST",
          { optionId: option },
          a.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          `/plans/${plan.id}/votes/${option}`,
          "PUT",
          { vote: "no" },
          b.cookie,
        )
      ).status,
    ).toBe(409);
  }, 60000);
});
it("rejects invalid payloads and isolates member preferences", async () => {
  const a = await register("validation@example.se", "validation-invite"),
    b = await register("isolation@example.se", "isolation-invite");
  expect(
    (
      await call(
        "/availability",
        "PUT",
        { slots: [{ day: 7, period: "evening", preference: "often" }] },
        a.cookie,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        "/plans",
        "POST",
        { title: "Bad plan", gameId: "the-warren", options: [null, null] },
        a.cookie,
      )
    ).status,
  ).toBe(400);
  await call(
    "/interests/the-warren",
    "PUT",
    { wantPlay: true, wantGm: false },
    a.cookie,
  );
  const players = await (
    await call("/games/the-warren/players", "GET", undefined, b.cookie)
  ).json<any>();
  expect(players.players[0]).not.toHaveProperty("email");
  const common = await (
    await call("/games/the-warren/availability", "GET", undefined, b.cookie)
  ).json<any>();
  expect(common.slots).toHaveLength(21);
  expect(common.slots[0].unsetCount).toBe(1);
  const code = await (
    await call("/discord/link-code", "POST", {}, b.cookie)
  ).json<any>();
  expect(code.code.length).toBe(24);
  expect(
    await env.DB.prepare("SELECT * FROM discord_link_codes WHERE code_hash=?")
      .bind(await digest(code.code))
      .first(),
  ).not.toBeNull();
}, 60000);
