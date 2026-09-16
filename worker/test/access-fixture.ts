import { vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
export const accessBindings = {
  ACCESS_TEAM_DOMAIN: "https://test-groblus.cloudflareaccess.com",
  ACCESS_AUD: "test-groblus-audience",
};
let signingKey: CryptoKey;
export async function setupAccess() {
  const pair = await generateKeyPair("RS256", { extractable: true });
  signingKey = pair.privateKey;
  const key = { ...await exportJWK(pair.publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    if (String(url) !== `${accessBindings.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) throw new Error("Unexpected test network call");
    return Response.json({keys: [key]});
  }));
}
export async function accessToken(email: string, overrides: Record<string, unknown> = {}) {
  return new SignJWT({ email, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(String(overrides.iss ?? accessBindings.ACCESS_TEAM_DOMAIN))
    .setAudience(String(overrides.aud ?? accessBindings.ACCESS_AUD))
    .setSubject(String(overrides.sub ?? email))
    .setIssuedAt().setExpirationTime(Number(overrides.exp ?? Math.floor(Date.now()/1000)+3600))
    .sign(signingKey);
}
