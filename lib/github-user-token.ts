import { createHttpError } from "./api-error";

type GithubAccount = {
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
};
type TokenResult = { accessToken: string; accessTokenExpiresAt?: Date | string | null };

export function createGithubTokenResolver({ readAccount, refresh }: {
  readAccount: (userId: string) => Promise<GithubAccount | undefined>;
  refresh: (userId: string) => Promise<TokenResult>;
}) {
  const inFlight = new Map<string, Promise<string>>();
  const usable = (account: GithubAccount | undefined) => Boolean(account?.accessToken
    && (!account.accessTokenExpiresAt || account.accessTokenExpiresAt.getTime() > Date.now() + 5000));

  return async (userId: string): Promise<string> => {
    const account = await readAccount(userId);
    if (usable(account)) return account!.accessToken!;
    if (!account?.refreshToken || (account.refreshTokenExpiresAt && account.refreshTokenExpiresAt.getTime() <= Date.now())) {
      throw createHttpError("GitHub authentication failed. Please sign in to GitHub again.", 401);
    }
    const pending = inFlight.get(userId);
    if (pending) return pending;
    const job = (async () => {
      try {
        // Another request/server may already have rotated the single-use token.
        const current = await readAccount(userId);
        if (usable(current)) return current!.accessToken!;
        const tokens = await refresh(userId);
        if (!tokens.accessToken || (tokens.accessTokenExpiresAt && new Date(tokens.accessTokenExpiresAt).getTime() <= Date.now())) {
          throw new Error("Refreshed token is expired.");
        }
        return tokens.accessToken;
      } catch {
        const current = await readAccount(userId);
        if (usable(current)) return current!.accessToken!;
        // A failed upstream refresh must not delete the valid CMS session.
        throw createHttpError("GitHub 연결 갱신에 실패했어요. 잠시 후 다시 저장해 주세요. 초안은 브라우저에 보관돼요.", 503);
      }
    })();
    inFlight.set(userId, job);
    try { return await job; }
    finally { inFlight.delete(userId); }
  };
}
