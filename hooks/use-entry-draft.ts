"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseFormReturn, FieldValues } from "react-hook-form";
import { parseEntryDraft, type EntryDraft } from "@/lib/entry-draft";

export function useEntryDraft(form: UseFormReturn<FieldValues>, storageKey?: string, baseSha?: string, defaultValues?: FieldValues) {
  const [recovery, setRecovery] = useState<EntryDraft | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const pendingRef = useRef(false);
  const baselineRef = useRef("");
  const latestBaseSha = useRef(baseSha);
  latestBaseSha.current = baseSha;

  const persist = useCallback(() => {
    if (!storageKey || pendingRef.current) return;
    const values = form.getValues();
    try {
      if (JSON.stringify(values) === baselineRef.current) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      window.localStorage.setItem(storageKey, JSON.stringify({
        version: 1, baseSha: latestBaseSha.current, savedAt: Date.now(), values,
      } satisfies EntryDraft));
      setStorageFailed(false);
    } catch { setStorageFailed(true); }
  }, [form, storageKey]);

  useEffect(() => {
    baselineRef.current = JSON.stringify(form.getValues());
    if (!storageKey) return;
    try {
      const draft = parseEntryDraft(window.localStorage.getItem(storageKey));
      if (draft && JSON.stringify(draft.values) !== baselineRef.current) {
        pendingRef.current = true;
        setRecovery(draft);
      }
    } catch { setStorageFailed(true); }

    // Rich-text updates are already canonical form values. Persist synchronously
    // so a reload immediately after typing cannot outrun a debounce timer.
    const subscription = form.watch((_values, info) => {
      if (info.name) persist();
    });
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);
    return () => {
      persist();
      subscription.unsubscribe();
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", persist);
    };
  }, [form, persist, storageKey]);

  useEffect(() => {
    // A pristine form can receive a newer server version on focus/reconnect.
    if (defaultValues && !form.formState.isDirty) baselineRef.current = JSON.stringify(defaultValues);
  }, [defaultValues, form]);

  const restore = () => {
    if (!recovery) return;
    pendingRef.current = false;
    form.reset(recovery.values, { keepDefaultValues: true });
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
    baselineRef.current = JSON.stringify(values);
    if (JSON.stringify(form.getValues()) !== baselineRef.current) {
      persist(); // Changes typed while the request was running must survive.
      return;
    }
    form.reset(values);
    discard();
  };

  return { recovery, restore, discard, saved, storageFailed };
}
