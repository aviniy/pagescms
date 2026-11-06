import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePublication, type PublicationJob, type PublicationRun } from "./publication";
import { getPublicationProgress } from "./github-publication";

const sha = "a".repeat(40);
const nextSha = "b".repeat(40);
const run: PublicationRun = { id: 1, head_sha: sha, status: "in_progress", conclusion: null, html_url: "https://github.com/example/site/actions/runs/1" };
const build: PublicationJob = { name: "build", status: "completed", conclusion: "success" };
const deploy: PublicationJob = { name: "deploy", status: "in_progress", conclusion: null };

test("a saved commit waits for its workflow instead of implying publication", () => {
  assert.deepEqual(summarizePublication(sha, null), {
    commitSha: sha, runUrl: null, detail: null, stage: "saved", percent: 10,
    message: "저장 완료 · 배포 시작 대기", terminal: false,
  });
});

test("queued workflows and active build steps stay below deployment progress", () => {
  assert.equal(summarizePublication(sha, { ...run, status: "pending" }).percent, 20);
  const progress = summarizePublication(sha, run, [{
    ...build, status: "in_progress", conclusion: null,
    steps: [
      { name: "Checkout", status: "completed", conclusion: "success" },
      { name: "Build site", status: "in_progress", conclusion: null },
    ],
  }]);
  assert.equal(progress.stage, "building");
  assert.equal(progress.detail, "Build site");
  assert.ok(progress.percent > 25 && progress.percent < 75);
  assert.equal(progress.terminal, false);
});

test("completed build and deployment queue are 75%, site sync is 90%", () => {
  assert.equal(summarizePublication(sha, run, [build, { ...deploy, status: "queued" }]).percent, 75);
  assert.equal(summarizePublication(sha, run, [build, deploy]).percent, 90);
});

test("100% requires both workflow success and a successful deployment job", () => {
  const jobs = [build, { ...deploy, status: "completed", conclusion: "success" }];
  assert.equal(summarizePublication(sha, run, jobs).percent, 90);
  const completed = { ...run, status: "completed", conclusion: "success" };
  assert.equal(summarizePublication(sha, completed, jobs).percent, 100);
  assert.equal(summarizePublication(sha, completed, jobs).stage, "published");
  assert.equal(summarizePublication(sha, completed, [build]).stage, "unverified");
  assert.ok(summarizePublication(sha, completed, [build]).percent < 100);
  assert.ok(summarizePublication(sha, completed, []).percent < 100);
});

test("deployment action steps are recognized even with a custom job name", () => {
  const progress = summarizePublication(sha, { ...run, status: "completed", conclusion: "success" }, [{
    name: "release-site", status: "completed", conclusion: "success",
    steps: [{ name: "Run actions/deploy-pages@v4", status: "completed", conclusion: "success" }],
  }]);
  assert.equal(progress.stage, "published");
});

for (const conclusion of ["failure", "cancelled", "timed_out", "skipped", "action_required"]) {
  test(`${conclusion} cannot be reported as 100%`, () => {
    const progress = summarizePublication(sha, { ...run, status: "completed", conclusion }, [build, deploy]);
    assert.ok(progress.percent < 100);
    assert.equal(progress.terminal, true);
    assert.notEqual(progress.stage, "published");
  });
}

type Client = Parameters<typeof getPublicationProgress>[0];
const scope = { owner: "example", repo: "site", branch: "main", sha };

function mockClient({ original, candidate, comparison = "ahead" }: {
  original: PublicationRun | null; candidate?: PublicationRun; comparison?: string;
}) {
  const requestedRuns: number[] = [];
  const queries: Array<Record<string, unknown>> = [];
  const client = {
    rest: {
      actions: {
        listWorkflowRuns: async (query: Record<string, unknown>) => {
          queries.push(query);
          return { data: { workflow_runs: query.head_sha ? (original ? [original] : []) : (candidate ? [candidate] : []) } };
        },
        listJobsForWorkflowRun: () => {},
      },
      repos: { compareCommitsWithBasehead: async () => ({ data: { status: comparison } }) },
    },
    paginate: async (_method: unknown, query: { run_id: number }) => {
      requestedRuns.push(query.run_id);
      return [build, { ...deploy, status: "completed", conclusion: "success" }];
    },
  };
  return { client: client as unknown as Client, requestedRuns, queries };
}

test("lookups use the saved commit SHA, branch, push event and deployment workflow", async () => {
  const mock = mockClient({ original: null });
  const progress = await getPublicationProgress(mock.client, scope);
  assert.equal(progress.stage, "saved");
  assert.deepEqual(mock.queries, [{ owner: "example", repo: "site", workflow_id: "deploy.yml", branch: "main", event: "push", head_sha: sha, per_page: 5 }]);
  assert.deepEqual(mock.requestedRuns, []);
});

test("a cancelled deployment follows a newer deployment containing the saved commit", async () => {
  const mock = mockClient({
    original: { ...run, status: "completed", conclusion: "cancelled" },
    candidate: { ...run, id: 2, head_sha: nextSha, status: "completed", conclusion: "success" },
  });
  const progress = await getPublicationProgress(mock.client, scope);
  assert.equal(progress.stage, "published");
  assert.equal(progress.commitSha, nextSha);
  assert.ok(progress.detail?.includes("최신 배포"));
  assert.deepEqual(mock.requestedRuns, [2]);
});

test("a force-pushed unrelated success cannot mark the saved content as published", async () => {
  const mock = mockClient({
    original: { ...run, status: "completed", conclusion: "cancelled" },
    candidate: { ...run, id: 2, head_sha: nextSha, status: "completed", conclusion: "success" },
    comparison: "diverged",
  });
  const progress = await getPublicationProgress(mock.client, scope);
  assert.equal(progress.stage, "cancelled");
  assert.equal(progress.commitSha, sha);
  assert.deepEqual(mock.requestedRuns, [1]);
});

test("recent cancellation leaves a grace period for a replacement to appear", async () => {
  const mock = mockClient({ original: { ...run, status: "completed", conclusion: "cancelled", updated_at: new Date().toISOString() } });
  const progress = await getPublicationProgress(mock.client, scope);
  assert.equal(progress.terminal, false);
  assert.equal(progress.message, "배포가 교체되었는지 확인 중");
});
