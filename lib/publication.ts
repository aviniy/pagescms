export type PublicationStage =
  | "saved" | "queued" | "building" | "deploying" | "published"
  | "failed" | "cancelled" | "unverified";

export type PublicationProgress = {
  stage: PublicationStage;
  percent: number;
  message: string;
  detail: string | null;
  terminal: boolean;
  runUrl: string | null;
  commitSha: string;
};

export type PublicationRun = {
  id: number;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  updated_at?: string;
};

export type PublicationJob = {
  name: string;
  status: string;
  conclusion: string | null;
  steps?: Array<{ name: string; status: string; conclusion: string | null }>;
};

// Progress represents observed milestones, never elapsed time or upload bytes.
export function summarizePublication(
  commitSha: string,
  run: PublicationRun | null,
  jobs: PublicationJob[] = [],
): PublicationProgress {
  const base = { commitSha: run?.head_sha ?? commitSha, runUrl: run?.html_url ?? null, detail: null };
  if (!run) {
    return { ...base, stage: "saved", percent: 10, message: "저장 완료 · 배포 시작 대기", terminal: false };
  }

  const deploymentJobs = jobs.filter((job) => (
    /^(deploy|publish)(\b|[_-])|github[ -]?pages/i.test(job.name)
    || job.steps?.some((step) => /actions\/deploy-pages@/i.test(step.name))
  ));
  const buildJobs = jobs.filter((job) => !deploymentJobs.includes(job));
  const buildSteps = buildJobs.flatMap((job) => job.steps ?? []);
  const finishedSteps = buildSteps.filter((step) => step.status === "completed").length;
  const buildPercent = buildSteps.length ? 25 + Math.floor(45 * finishedSteps / buildSteps.length) : 25;
  const deployStarted = deploymentJobs.some((job) => job.status === "in_progress"
    || (job.status === "completed" && !["skipped", "cancelled"].includes(job.conclusion ?? "")));
  const buildFinished = buildJobs.length > 0 && buildJobs.every((job) => job.status === "completed" && job.conclusion === "success");
  const percent = deployStarted ? 90 : buildFinished ? 75 : jobs.some((job) => job.status === "in_progress") ? buildPercent : 20;

  if (run.status === "completed") {
    if (run.conclusion === "success") {
      // A successful build alone does not establish that the site was deployed.
      const deployed = deploymentJobs.length > 0 && deploymentJobs.every((job) => job.conclusion === "success");
      return deployed
        ? { ...base, stage: "published", percent: 100, message: "게시 완료 · 사이트 반영 완료", terminal: true }
        : { ...base, stage: "unverified", percent: Math.min(percent, 90), message: "작업 완료 · 사이트 반영 확인 필요", terminal: true };
    }
    if (run.conclusion === "cancelled") {
      return { ...base, stage: "cancelled", percent, message: "배포 취소 · 글은 저장되어 있어요", terminal: true };
    }
    const failedJob = jobs.find((job) => ["failure", "timed_out", "action_required"].includes(job.conclusion ?? ""));
    const failedStep = failedJob?.steps?.find((step) => step.conclusion === "failure");
    return { ...base, stage: "failed", percent, message: "게시 실패 · 글은 저장되어 있어요",
      detail: failedJob ? `${deploymentJobs.includes(failedJob) ? "배포" : "빌드"} 실패${failedStep ? `: ${failedStep.name}` : ""} · 배포 상세에서 원인을 확인할 수 있어요.` : null,
      terminal: true };
  }

  if (deployStarted) {
    return { ...base, stage: "deploying", percent: 90, message: "사이트에 반영 중", terminal: false };
  }
  if (buildFinished) {
    return { ...base, stage: "queued", percent: 75, message: "빌드 완료 · 배포 대기", terminal: false };
  }
  if (jobs.some((job) => job.status === "in_progress")) {
    const currentStep = buildSteps.find((step) => step.status === "in_progress");
    return { ...base, stage: "building", percent: buildPercent, message: "사이트 빌드 중", detail: currentStep?.name ?? null, terminal: false };
  }
  return { ...base, stage: "queued", percent: 20, message: "GitHub 배포 대기 중", terminal: false };
}
