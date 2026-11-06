export type ServerDraft = {
  identity: string; version: number; values: Record<string, unknown>;
  savedAt: string; baseSha?: string | null; path?: string | null;
  history: Array<{ values: Record<string, unknown>; savedAt: number }>;
};
export type DraftSnapshot = { values: Record<string, unknown>; path?: string; baseSha?: string };
export const draftFingerprint = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);

/** Server revisions are independent from GitHub blob SHAs. Failed requests retain their id. */
export function createDraftSync(options: {
  load: () => Promise<ServerDraft | null>;
  write: (input: DraftSnapshot & { identity: string; version: number; requestId: string }) => Promise<ServerDraft>;
  identity: string;
  onLoad: (draft: ServerDraft | null) => void;
  onSaved: (draft: ServerDraft) => void;
}) {
  let version = 0;
  let identity = options.identity;
  let confirmed = "";
  let blocked = false;
  let attempt: Parameters<typeof options.write>[0] | null = null;
  let tail = Promise.resolve();
  let loaded = false;
  let loading: Promise<void> | undefined;
  const load = () => loading ??= options.load().then((draft) => {
    if (draft) { version = draft.version; identity = draft.identity; confirmed = draftFingerprint({ values: draft.values, path: draft.path ?? undefined, baseSha: draft.baseSha ?? undefined }); }
    loaded = true;
    options.onLoad(draft);
  }).finally(() => { loading = undefined; });
  const ready = load();
  // A failed initial read must never be mistaken for an empty server draft.
  void ready.catch(() => {});
  const fingerprint = draftFingerprint;
  const commit = async () => {
    if (!attempt) return;
    const saved = await options.write(attempt);
    version = saved.version;
    confirmed = fingerprint({ values: attempt.values, path: attempt.path, baseSha: attempt.baseSha });
    attempt = null;
    options.onSaved(saved);
  };
  return {
    ready,
    save(input: DraftSnapshot) {
      const snapshot = structuredClone(input);
      const job = tail.then(async () => {
        if (!loaded) await load();
        if (blocked) throw new Error("다른 탭에서 변경된 초안이 있어요. 초안을 백업한 뒤 새로고침해 주세요.");
        try {
          // Resolve an uncertain response with the same id before sending newer text.
          await commit();
          if (confirmed === fingerprint(snapshot)) return;
          attempt = { ...snapshot, identity, version, requestId: crypto.randomUUID() };
          await commit();
        } catch (error) {
          if ((error as { status?: number }).status === 409) blocked = true;
          throw error;
        }
      });
      tail = job.catch(() => {});
      return job;
    },
  };
}
