import assert from "node:assert/strict";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { sessionPolicy } from "./session-policy";

test("the real auth handler issues a 30-day session and rolls its cookie on access", async () => {
  const now = Date.now();
  const token = "test-session-token";
  // A still-valid session issued before changing the policy also gets extended.
  const originalExpiry = new Date(now + 7 * 86400_000 - 7200_000);
  const store = {
    user: [{ id: "user", name: "test", email: "test@example.com", emailVerified: true, createdAt: new Date(now), updatedAt: new Date(now) }],
    session: [{ id: "session", userId: "user", token, expiresAt: originalExpiry, createdAt: new Date(now - 7200_000), updatedAt: new Date(now - 7200_000) }],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000", secret: "test-secret-only-for-in-memory-auth-tests-12345",
    database: memoryAdapter(store), session: sessionPolicy,
  });
  // Use the cookie signer shipped with Better Auth, as on an actual login.
  const { makeSignature } = await import("better-auth/crypto");
  const signed = `${token}.${await makeSignature(token, "test-secret-only-for-in-memory-auth-tests-12345")}`;
  const response = await auth.handler(new Request("http://localhost:3000/api/auth/get-session", {
    headers: { Cookie: `better-auth.session_token=${encodeURIComponent(signed)}` },
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.id, "user");
  assert.ok(new Date(payload.session.expiresAt).getTime() > originalExpiry.getTime() + 3600_000);
  assert.ok(Math.abs(new Date(payload.session.expiresAt).getTime() - now - sessionPolicy.expiresIn * 1000) < 10000);
  const cookieAge = Number(response.headers.get("set-cookie")?.match(/Max-Age=(\d+)/i)?.[1]);
  assert.ok(cookieAge >= sessionPolicy.expiresIn - 5 && cookieAge <= sessionPolicy.expiresIn);
});

test("the installed Better Auth API refreshes and persists an expiring GitHub account", async () => {
  const store = { account: [{
    id: "account", providerId: "github", userId: "user", accountId: "github-id",
    accessToken: "old", refreshToken: "old-refresh", accessTokenExpiresAt: new Date(0),
    refreshTokenExpiresAt: new Date(Date.now() + 86400_000), createdAt: new Date(), updatedAt: new Date(),
  }] };
  let calls = 0;
  const auth = betterAuth({
    baseURL: "http://localhost:3000", secret: "test-secret-only-for-in-memory-auth-tests-12345",
    database: memoryAdapter(store), session: sessionPolicy,
    socialProviders: { github: {
      clientId: "test-only", clientSecret: "test-only",
      refreshAccessToken: async () => {
        calls++;
        return { accessToken: "rotated", refreshToken: "rotated-refresh", accessTokenExpiresAt: new Date(Date.now() + 28800_000) };
      },
    } },
  });
  const result = await auth.api.getAccessToken({ body: { providerId: "github", userId: "user" } });
  assert.equal(result.accessToken, "rotated");
  assert.equal(store.account[0].accessToken, "rotated");
  assert.equal(store.account[0].refreshToken, "rotated-refresh");
  assert.equal(calls, 1);
});
