"use client";
import { useEffect, useRef, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { createDraftSync, draftFingerprint, type ServerDraft } from "@/lib/draft-sync";

export type ServerDraftOptions = { scope: string; identity: string; path?: string; baseSha?: string; endpoint?: string };
export function useServerEntryDraft(form: UseFormReturn<FieldValues>, address: ServerDraftOptions | undefined, localRecovery: boolean) {
  const latest = useRef({ form, address, localRecovery });
  latest.current = { form, address, localRecovery };
  const [status, setStatus] = useState("서버 초안 확인 중…");
  const [loading, setLoading] = useState(Boolean(address));
  const [history, setHistory] = useState<ServerDraft["history"]>([]);
  const [savedAt, setSavedAt] = useState<string>();
  const [remote, setRemote] = useState<ServerDraft | null>(null);
  const saveRef = useRef<(metadata?: { path: string; baseSha: string }) => Promise<void>>(async () => {});
  const scope = address?.scope;
  const identity = address?.identity;
  const endpoint = address?.endpoint ?? "/api/drafts";

  useEffect(() => {
    if (!scope || !identity) { setLoading(false); return; }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstChange = 0;
    let changed = false;
    let pending = 0;
    let lastConfirmed: ServerDraft | null = null;
    const api = async (response: Response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(response.status === 401 ? "로그인이 만료됐어요. 새 탭에서 다시 로그인하면 서버 임시저장을 재시도해요. 현재 내용은 브라우저에 보관돼요." : result.message || "서버 임시저장에 실패했어요. 브라우저 사본을 유지하고 재시도해요."), { status: response.status });
      return result.data;
    };
    const sync = createDraftSync({
      identity,
      load: () => apiFetch(),
      write: async (input) => api(await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, ...input }),
      })),
      onLoad: (draft) => {
        lastConfirmed = draft;
        if (!active) return;
        setRemote(draft);
        if (draft) {
          setHistory(draft.history); setSavedAt(draft.savedAt);
          if (!changed && !latest.current.form.formState.isDirty && !latest.current.localRecovery) {
            latest.current.form.reset(draft.values, { keepDefaultValues: true });
          }
        }
        setLoading(false); setStatus(draft ? `서버 임시저장 완료 · ${new Date(draft.savedAt).toLocaleTimeString("ko-KR")}` : "자동 임시저장 켜짐");
      },
      onSaved: (draft) => {
        lastConfirmed = draft;
        if (!active) return;
        setRemote(draft);
        setSavedAt(draft.savedAt); setHistory(draft.history);
        setStatus(draftFingerprint(draft.values) === draftFingerprint(latest.current.form.getValues())
          ? `서버 임시저장 완료 · ${new Date(draft.savedAt).toLocaleTimeString("ko-KR")}` : "추가 수정 내용 임시저장 대기 중…");
      },
    });
    async function apiFetch() {
      const path = latest.current.address?.path;
      return api(await fetch(`${endpoint}?${new URLSearchParams({ scope: scope!, identity: identity!, ...(path ? { path } : {}) })}`, { cache: "no-store" }));
    }
    void sync.ready.catch((error) => { if (active) { setLoading(false); setStatus(error.message); } });
    const save = async (metadata?: { path: string; baseSha: string }) => {
      if (latest.current.localRecovery) throw new Error("먼저 초안 복구 여부를 선택해 주세요.");
      clearTimeout(timer); firstChange = 0;
      changed = true;
      pending++; setStatus("서버 임시저장 중… · 계속 작성할 수 있어요");
      const snapshot = { values: structuredClone(latest.current.form.getValues()), path: latest.current.address?.path, baseSha: latest.current.address?.baseSha, ...metadata };
      try {
        await sync.save(snapshot);
        changed = draftFingerprint(snapshot.values) !== draftFingerprint(latest.current.form.getValues());
        if (active && lastConfirmed) setStatus(changed ? "추가 수정 내용 임시저장 대기 중…" : `서버 임시저장 완료 · ${new Date(lastConfirmed.savedAt).toLocaleTimeString("ko-KR")}`);
      } catch (error) {
        changed = true;
        if (active) setStatus((error as Error).message);
        throw error;
      } finally { pending--; }
    };
    saveRef.current = save;
    const schedule = () => {
      if (latest.current.localRecovery) return;
      changed = true;
      setStatus("변경 내용 임시저장 대기 중…");
      firstChange ||= Date.now();
      clearTimeout(timer);
      timer = setTimeout(() => { void save().catch(() => {}); }, Math.min(1000, Math.max(0, 5000 - (Date.now() - firstChange))));
    };
    const subscription = form.watch((_values, info) => { if (info.name) schedule(); });
    const retry = () => { if (changed && !pending) void save().catch(() => {}); };
    const retryTimer = setInterval(retry, 15000);
    window.addEventListener("online", retry); window.addEventListener("focus", retry);
    return () => {
      active = false; clearTimeout(timer); clearInterval(retryTimer); subscription.unsubscribe();
      window.removeEventListener("online", retry); window.removeEventListener("focus", retry);
    };
    // Identity is stable across first publication and SHA updates.
  }, [scope, identity, endpoint, form]);
  return { status, loading, history, savedAt, remote, save: (metadata?: { path: string; baseSha: string }) => saveRef.current(metadata), restore: (values: Record<string, unknown>) => {
    form.reset(values, { keepDefaultValues: true });
    return saveRef.current();
  } };
}
