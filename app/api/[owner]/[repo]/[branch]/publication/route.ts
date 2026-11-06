import { createOctokitInstance } from "@/lib/utils/octokit";
import { getToken } from "@/lib/token";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import { requireApiUserSession } from "@/lib/session-server";
import { getPublicationProgress } from "@/lib/github-publication";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;

    const sha = new URL(request.url).searchParams.get("sha") ?? "";
    if (!/^[a-f0-9]{40}$/i.test(sha)) throw createHttpError("Invalid commit SHA.", 400);

    const { token } = await getToken(sessionResult.user, params.owner, params.repo, true);
    const octokit = createOctokitInstance(token);
    const progress = await getPublicationProgress(octokit, { ...params, sha });

    return Response.json({ status: "success", data: progress }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
