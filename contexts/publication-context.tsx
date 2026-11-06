"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { requireApiSuccess } from "@/lib/api-client";
import type { ApiSuccess } from "@/types/api";
import type { PublicationProgress } from "@/lib/publication";
import { Button } from "@/components/ui/button";

type PublicationTarget = {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  path: string;
  trackedAt: number;
};

type PublicationContextValue = {
  trackPublication: (target: Omit<PublicationTarget, "trackedAt">) => void;
};

const PublicationContext = createContext<PublicationContextValue | null>(null);
const TRACKING_TIMEOUT_MS = 30 * 60 * 1000;

const fetchProgress = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  try {
    return await requireApiSuccess<ApiSuccess<PublicationProgress>>(response, "게시 상태를 확인하지 못했어요.");
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("상태 확인 실패"), { status: response.status });
  }
};

export function PublicationProvider({ children, userId }: { children: React.ReactNode; userId: string }) {
  const [target, setTarget] = useState<PublicationTarget | null>(null);
  const [restored, setRestored] = useState(false);
  const storageKey = `pages-cms-publication:v1:${userId}`;

  useEffect(() => {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as PublicationTarget | null;
      if (stored && [stored.owner, stored.repo, stored.branch, stored.path].every((value) => typeof value === "string")
        && /^[a-f0-9]{40}$/i.test(stored.commitSha)
        && typeof stored.trackedAt === "number" && Date.now() - stored.trackedAt < TRACKING_TIMEOUT_MS) {
        setTarget(stored);
      }
    } catch { /* Tracking still works when storage is unavailable. */ }
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    if (!restored) return;
    try {
      if (target) window.sessionStorage.setItem(storageKey, JSON.stringify(target));
      else window.sessionStorage.removeItem(storageKey);
    } catch { /* Storage is optional. */ }
  }, [restored, storageKey, target]);

  const trackPublication = useCallback((next: Omit<PublicationTarget, "trackedAt">) => {
    setTarget({ ...next, trackedAt: Date.now() });
  }, []);
  const value = useMemo(() => ({ trackPublication }), [trackPublication]);

  return (
    <PublicationContext.Provider value={value}>
      {children}
      {target ? <PublicationPanel key={target.commitSha} target={target} onClose={() => setTarget(null)} /> : null}
    </PublicationContext.Provider>
  );
}

function PublicationPanel({ target, onClose }: { target: PublicationTarget; onClose: () => void }) {
  const [trackingTimedOut, setTrackingTimedOut] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setTrackingTimedOut(true), Math.max(0, target.trackedAt + TRACKING_TIMEOUT_MS - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [target.trackedAt]);
  const apiUrl = `/api/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${encodeURIComponent(target.branch)}/publication?sha=${target.commitSha}`;
  const { data, error, isValidating, mutate } = useSWR<ApiSuccess<PublicationProgress>>(apiUrl, fetchProgress, {
    refreshInterval: (current) => current?.data.terminal || trackingTimedOut ? 0 : 8000,
    errorRetryCount: 3,
    errorRetryInterval: 15000,
    shouldRetryOnError: (error) => ![401, 403, 404].includes(error.status),
    revalidateOnFocus: true,
  });
  const progress = data?.data;
  const percent = progress?.percent ?? 10;
  const expired = !progress?.terminal && trackingTimedOut;
  const failed = ["failed", "cancelled", "unverified"].includes(progress?.stage ?? "");
  const published = progress?.stage === "published";
  const needsAttention = failed || Boolean(error) || expired;
  const message = error
    ? error.status === 401 ? "로그인 후 게시 상태를 다시 확인해 주세요."
      : error.status === 403 ? "배포 상태를 볼 권한이 없어요."
      : error.status === 404 ? "자동 배포를 찾지 못했어요. 글은 저장되어 있어요."
      : "상태 확인이 지연되고 있어요. 글은 저장되어 있어요."
    : expired ? "배포가 오래 걸리고 있어요. GitHub에서 확인해 주세요."
      : progress?.message ?? "저장 완료 · 배포 상태 확인 중";
  const runUrl = progress?.runUrl ?? `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/actions`;

  return (
    <section aria-label="게시 진행률" className="fixed bottom-4 left-4 z-50 w-[calc(100vw-2rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg sm:w-96">
      <div className="flex items-center gap-2">
        {needsAttention ? <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          : published ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            : <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" />}
        <span className="flex-1 text-sm font-semibold">게시 진행률</span>
        <span className="text-sm font-semibold tabular-nums">{percent}%</span>
        <Button variant="ghost" size="icon-sm" className="-mr-2 -mt-1" aria-label="게시 상태 닫기" onClick={onClose}><X /></Button>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={target.path}>{target.path.split("/").pop()}</p>
      <div role="progressbar" aria-label="단계별 게시 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% · ${message}`} className="my-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full motion-safe:transition-[width] ${needsAttention ? "bg-amber-500" : published ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${percent}%` }} />
      </div>
      <p role="status" aria-live="polite" className="text-sm font-medium">{message}</p>
      {progress?.stage === "deploying" && !needsAttention ? <p className="mt-1 text-xs text-muted-foreground">사이트 반영은 몇 분 걸릴 수 있어요.</p> : null}
      {progress?.detail && !error ? <p className="mt-1 break-words text-xs text-muted-foreground">{progress.detail}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">단계 기준 진행률</span>
        {error || expired ? <button type="button" className="inline-flex items-center gap-1 underline underline-offset-4" disabled={isValidating} onClick={() => void mutate()}><RefreshCw className="size-3" />다시 확인</button> : null}
        <a href={runUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">배포 상세<ExternalLink className="size-3" /></a>
      </div>
    </section>
  );
}

export function usePublication() {
  const context = useContext(PublicationContext);
  if (!context) throw new Error("usePublication must be used within a PublicationProvider");
  return context;
}
