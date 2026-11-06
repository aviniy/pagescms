import assert from "node:assert/strict";
import { test } from "node:test";
import { createGithubTokenResolver } from "./github-user-token";

const expired = { accessToken: "old", refreshToken: "refresh", accessTokenExpiresAt: new Date(0), refreshTokenExpiresAt: new Date(Date.now() + 86400_000) };

test("valid and non-expiring GitHub tokens do not refresh", async () => {
  let calls = 0;
  const resolve = createGithubTokenResolver({
    readAccount: async () => ({ ...expired, accessTokenExpiresAt: null }),
    refresh: async () => { calls++; return { accessToken: "new" }; },
  });
  assert.equal(await resolve("user"), "old");
  assert.equal(calls, 0);
});

test("concurrent requests share one GitHub token rotation", async () => {
  let calls = 0;
  const resolve = createGithubTokenResolver({
    readAccount: async () => expired,
    refresh: async () => {
      calls++;
      await new Promise((done) => setTimeout(done, 5));
      return { accessToken: "new", accessTokenExpiresAt: new Date(Date.now() + 28800_000) };
    },
  });
  assert.deepEqual(await Promise.all([resolve("user"), resolve("user"), resolve("user")]), ["new", "new", "new"]);
  assert.equal(calls, 1);
});

test("a refresh completed by another server is reused", async () => {
  let current = expired;
  const resolve = createGithubTokenResolver({
    readAccount: async () => current,
    refresh: async () => {
      current = { ...expired, accessToken: "other-server", accessTokenExpiresAt: new Date(Date.now() + 28800_000) };
      throw new Error("old refresh token was already used");
    },
  });
  assert.equal(await resolve("user"), "other-server");
});

test("temporary refresh failure is retryable, missing refresh credentials require sign-in", async () => {
  const unavailable = createGithubTokenResolver({ readAccount: async () => expired, refresh: async () => { throw new Error("network"); } });
  await assert.rejects(unavailable("user"), { status: 503 });
  const revoked = createGithubTokenResolver({ readAccount: async () => ({ ...expired, refreshToken: null }), refresh: async () => ({ accessToken: "unused" }) });
  await assert.rejects(revoked("user"), { status: 401 });
});
