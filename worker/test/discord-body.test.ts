import { it, expect } from "vitest";
import { handleDiscord } from "../src/discord";
import type { Env } from "../src/types";
// These paths must reject before D1 or cryptographic work is attempted.
const env = {} as Env;
it("caps unsigned chunked bytes even with a forged small Content-Length", async () => {
  let pulls = 0,
    cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(16_384));
    },
    cancel() {
      cancelled = true;
    },
  });
  const req = new Request("https://test/api/discord/interactions", {
    method: "POST",
    headers: { "Content-Length": "1" },
    body,
  });
  const response = await handleDiscord(req, env);
  expect(response.status).toBe(413);
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThanOrEqual(4);
});
it("uses byte count rather than decoded string length", async () => {
  const body = new TextEncoder().encode("å".repeat(20_000));
  const req = new Request("https://test/api/discord/interactions", {
    method: "POST",
    body,
  });
  expect((await handleDiscord(req, env)).status).toBe(413);
});
it("returns bounded 400 for a failed transport without leaking error text", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("private transport detail"));
    },
  });
  const req = new Request("https://test/api/discord/interactions", {
    method: "POST",
    body,
  });
  const response = await handleDiscord(req, env);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request body" });
});
it("permits a bounded body to reach signature verification", async () => {
  const req = new Request("https://test/api/discord/interactions", {
    method: "POST",
    body: '{"type":1}',
  });
  expect((await handleDiscord(req, env)).status).toBe(401);
});
