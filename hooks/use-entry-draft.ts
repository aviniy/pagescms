"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseFormReturn, FieldValues } from "react-hook-form";
import { DRAFT_HISTORY_LIMIT, parseEntryDraft, parseEntryDraftHistory, type EntryDraft } from "@/lib/entry-draft";

export function useEntryDraft(form: UseFormReturn<FieldValues>, storageKey?: string, baseSha?: string, defaultValues?: FieldValues) {
  const [recovery, setRecovery] = useState<EntryDraft | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const storageFailedRef = useRef(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [history, setHistory] = useState<EntryDraft[]>([]);
  const historyRef = useRef<EntryDraft[]>([]);
  const previousRef = useRef<EntryDraft | null>(null);
  const pendingRef = useRef(false);
  const baselineRef = useRef("");
  const latestBaseSha = useRef(baseSha);
  latestBaseSha.current = baseSha;

  const checkpoint = useCallback((previous: EntryDraft) => {
    if (!storageKey || historyRef.current.some((draft) => JSON.stringify(draft.values) === JSON.stringify(previous.values))) return;
    const next = [previous, ...historyRef.current].slice(0, DRAFT_HISTORY_LIMIT);
    try {
      window.localStorage.setItem(`${storageKey}:history`, JSON.stringify(next));
      historyRef.current = next;
      setHistory(next);
    } catch { /* Preserve the current draft even if history storage is full. */ }
  }, [storageKey]);

  const persist = useCallback(() => {
    if (!storageKey || pendingRef.current) return;
    const values = form.getValues();
    try {
      if (JSON.stringify(values) === baselineRef.current) {
        if (previousRef.current && JSON.stringify(previousRef.current.values) !== JSON.stringify(values)) checkpoint(previousRef.current);
        previousRef.current = null;
        window.localStorage.removeItem(storageKey);
        storageFailedRef.current = false;
        setStorageFailed(false);
        return;
      }
      const now = Date.now();
      const next = {
        version: 1, baseSha: latestBaseSha.current, savedAt: Date.now(), values,
      } satisfies EntryDraft;
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      const previous = previousRef.current;
      const previousBody = typeof previous?.values.body === "string" ? previous.values.body : "";
      const nextBody = typeof values.body === "string" ? values.body : "";
      if (previous && JSON.stringify(previous.values) !== JSON.stringify(values)
        && (!historyRef.current.length || now - historyRef.current[0].savedAt >= 60_000
          || (previousBody.length > 200 && nextBody.length < previousBody.length / 2))) checkpoint(previous);
      // Clone: nested form objects can mutate after getValues() returns.
      previousRef.current = structuredClone(next);
      setLastSavedAt((last) => last && now - last < 1000 ? last : now);
      setStorageFailed(false);
      storageFailedRef.current = false;
    } catch {
      storageFailedRef.current = true;
      setStorageFailed(true);
    }
  }, [checkpoint, form, storageKey]);

  useEffect(() => {
    baselineRef.current = JSON.stringify(form.getValues());
    if (!storageKey) return;
    try {
      const draft = parseEntryDraft(window.localStorage.getItem(storageKey));
      previousRef.current = draft;
      historyRef.current = parseEntryDraftHistory(window.localStorage.getItem(`${storageKey}:history`));
      setHistory(historyRef.current);
      if (draft && JSON.stringify(draft.values) !== baselineRef.current) {
        pendingRef.current = true;
        setRecovery(draft);
        setLastSavedAt(draft.savedAt);
      }
    } catch { setStorageFailed(true); }

    // Rich-text updates are already canonical form values. Persist synchronously
    // so a reload immediately after typing cannot outrun a debounce timer.
    const subscription = form.watch((_values, info) => {
      if (info.name) persist();
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      persist();
      if (storageFailedRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      persist();
      subscription.unsubscribe();
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [form, persist, storageKey]);

  useEffect(() => {
    // A pristine form can receive a newer server version on focus/reconnect.
    if (defaultValues && !form.formState.isDirty) baselineRef.current = JSON.stringify(defaultValues);
  }, [defaultValues, form]);

  const restore = (selected = recovery) => {
    if (!selected) return;
    // Keep the current editor contents before restoring an older checkpoint.
    if (previousRef.current) checkpoint(previousRef.current);
    pendingRef.current = false;
    form.reset(selected.values, { keepDefaultValues: true });
    setRecovery(null);
    persist();
  };

  const discard = () => {
    try { if (storageKey) window.localStorage.removeItem(storageKey); }
    catch { setStorageFailed(true); }
    pendingRef.current = false;
    setRecovery(null);
  };

  const saved = (values: Record<string, unknown>) => {
    checkpoint({ version: 1, baseSha: latestBaseSha.current, savedAt: Date.now(), values });
    baselineRef.current = JSON.stringify(values);
    if (JSON.stringify(form.getValues()) !== baselineRef.current) {
      persist(); // Changes typed while the request was running must survive.
      return;
    }
    form.reset(values);
    discard();
  };

  const download = () => {
    const backup: EntryDraft = { version: 1, baseSha: latestBaseSha.current, savedAt: Date.now(), values: recovery?.values ?? form.getValues() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pages-cms-draft-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return { recovery, restore, discard, saved, storageFailed, lastSavedAt, history, download };
}
