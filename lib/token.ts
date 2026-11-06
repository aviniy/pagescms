/**
 * Token helper functions.
 */

import { cache } from "react";
import { App } from "@octokit/app";
import { decrypt, encrypt } from "@/lib/crypto";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { db } from "@/db";
import {
  githubInstallationTokenTable, accountTable
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { User } from "@/types/user";
import { getGithubAccount } from "@/lib/github-account";
import { createHttpError } from "@/lib/api-error";
import { collaboratorMatchesUserForRepo } from "@/lib/collaborator-access";
import { createGithubTokenResolver } from "@/lib/github-user-token";

const installationTokenRefreshInFlight = new Map<number, Promise<string>>();
const resolveUserToken = createGithubTokenResolver({
  readAccount: (userId) => db.query.accountTable.findFirst({
    where: and(eq(accountTable.userId, userId), eq(accountTable.providerId, "github")),
  }),
  refresh: async (userId) => {
    // Dynamic import avoids the auth -> profile sync -> token import cycle.
    const { auth } = await import("@/lib/auth");
    return auth.api.getAccessToken({ body: { providerId: "github", userId } });
  },
});

// Get a token for a user (including collagborators who need to provide an owner/repo scope).
const getToken = cache(async (
  user: User,
  owner: string,
  repo: string,
  verifyGithubAccess: boolean = false,
) => {
  const githubAccount = await getGithubAccount(user.id);
  let githubAuthError: unknown;
  if (githubAccount?.accessToken) {
    let userToken: string | undefined;
    try { userToken = await getUserToken(user.id); }
    catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
      githubAuthError = error;
    }
    const hasGithubAccess = userToken && await canAccessRepoWithToken(userToken, owner, repo);
    if (hasGithubAccess) return {
      token: userToken!,
      source: "user" as const,
    };
  }

  const permission = await db.query.collaboratorTable.findFirst({
    where: collaboratorMatchesUserForRepo(user, owner, repo),
  });
  if (permission) {
    const installationToken = await getInstallationToken(owner, repo);

    return {
      token: installationToken,
      source: "installation" as const,
    };
  }

  if (githubAccount?.accessToken && verifyGithubAccess) {
    if (githubAuthError) throw githubAuthError;
    throw createHttpError(
      `You do not have permission to access "${owner}/${repo}".`,
      403,
    );
  }

  if (githubAuthError) throw githubAuthError;
  throw createHttpError(
    `You do not have permission to access "${owner}/${repo}".`,
    403,
  );
});

// Get the GitHub App installation token for a specific repository.
const getInstallationToken = cache(async (owner: string, repo: string) => {
  const app = new App({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  });

  const repoInstallation = await app.octokit.request(
    "GET /repos/{owner}/{repo}/installation",
    { owner, repo },
  );
  if (!repoInstallation) throw new Error(`Installation token not found for "${owner}/${repo}".`);

  const installationId = repoInstallation.data.id;
  const tokenData = await db.query.githubInstallationTokenTable.findFirst({
    where: eq(githubInstallationTokenTable.installationId, installationId)
  });

  if (tokenData && Date.now() < tokenData.expiresAt.getTime() - 60_000) {
    const token = await decrypt(tokenData.ciphertext, tokenData.iv);
    if (!token) throw new Error(`Token could not be retrieved and/or decrypted.`);
    return token;
  }

  const existingRefresh = installationTokenRefreshInFlight.get(installationId);
  if (existingRefresh) {
    return existingRefresh;
  }

  const refreshJob = (async () => {
    const installationToken = await app.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
      },
    );

    const { ciphertext, iv } = await encrypt(installationToken.data.token);
    const expiresAt = new Date(installationToken.data.expires_at);

    if (tokenData) {
      await db.update(githubInstallationTokenTable).set({
        ciphertext,
        iv,
        expiresAt
      }).where(
        eq(githubInstallationTokenTable.id, tokenData.id)
      );
    } else {
      await db.insert(githubInstallationTokenTable).values({
        ciphertext,
        iv,
        installationId,
        expiresAt
      }).onConflictDoUpdate({
        target: githubInstallationTokenTable.installationId,
        set: {
          ciphertext,
          iv,
          expiresAt,
        },
      });
    }

    return installationToken.data.token;
  })();

  installationTokenRefreshInFlight.set(installationId, refreshJob);
  try {
    return await refreshJob;
  } finally {
    installationTokenRefreshInFlight.delete(installationId);
  }
});

// Get the GitHub user token.
const getUserToken = cache(async (userId: string) => {
  return resolveUserToken(userId);
});

const canAccessRepoWithToken = async (
  token: string,
  owner: string,
  repo: string,
) => {
  try {
    const octokit = createOctokitInstance(token);
    await octokit.rest.repos.get({ owner, repo });
    return true;
  } catch {
    return false;
  }
};

export { getInstallationToken, getUserToken, getToken };
