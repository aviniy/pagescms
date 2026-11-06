import type { createOctokitInstance } from "./utils/octokit";
import { summarizePublication, type PublicationRun } from "./publication";

// Track the site's Pages workflow, never an unrelated successful CI run.
const WORKFLOW = "deploy.yml";

export async function getPublicationProgress(
  octokit: ReturnType<typeof createOctokitInstance>,
  { owner, repo, branch, sha }: { owner: string; repo: string; branch: string; sha: string },
) {
  const scope = { owner, repo, workflow_id: WORKFLOW, branch, event: "push" as const };
  const response = await octokit.rest.actions.listWorkflowRuns({ ...scope, head_sha: sha, per_page: 5 });
  let run: PublicationRun | null = response.data.workflow_runs[0] ?? null;
  let followingLatest = false;

  if (run?.status === "completed" && run.conclusion === "cancelled") {
    const latest = await octokit.rest.actions.listWorkflowRuns({ ...scope, per_page: 1 });
    const candidate = latest.data.workflow_runs[0];
    if (candidate && candidate.id !== run.id && candidate.head_sha !== sha) {
      const comparison = await octokit.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${sha}...${candidate.head_sha}` });
      // A replacement must contain the saved commit, including after a force-push.
      if (comparison.data.status === "ahead") {
        run = candidate;
        followingLatest = true;
      }
    }
  }

  const jobs = run
    ? await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, { owner, repo, run_id: run.id, filter: "latest", per_page: 100 })
    : [];
  const progress = summarizePublication(sha, run, jobs);
  if (followingLatest) progress.detail = "새 저장 내용이 포함된 최신 배포를 확인하고 있어요.";

  // GitHub may report cancellation before the replacement run is visible.
  if (progress.stage === "cancelled" && run?.updated_at && Date.now() - Date.parse(run.updated_at) < 30_000) {
    progress.terminal = false;
    progress.message = "배포가 교체되었는지 확인 중";
  }
  return progress;
}
