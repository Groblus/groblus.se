import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./types";

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
// Random, one-use Discord linking codes, not login credentials or sessions.
export const token = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
// Official Cloudflare Access integration. Static Assets currently cannot pass
// ctx.access through its internal router, so use Cloudflare's documented jose
// validation of the platform-issued assertion. Never trust the email header.
// https://developers.cloudflare.com/workers/configuration/cloudflare-access/
// https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
export async function accessIdentity(req: Request, env: Env): Promise<{email: string} | null> {
  const assertion = req.headers.get("Cf-Access-Jwt-Assertion");
  const issuer = env.ACCESS_TEAM_DOMAIN;
  if (!assertion || !issuer || !env.ACCESS_AUD) return null;
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) return null;
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(assertion, keys, {
      issuer, audience: env.ACCESS_AUD, algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "email"],
    });
    if (typeof payload.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || payload.email.length > 254 || !payload.sub) return null;
    return { email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}
