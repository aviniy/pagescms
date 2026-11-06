export type EntryDraft = {
  version: 1;
  baseSha?: string;
  savedAt: number;
  values: Record<string, unknown>;
};

export function parseEntryDraft(raw: string | null): EntryDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    if (draft?.version !== 1 || typeof draft.savedAt !== "number"
      || !draft.values || typeof draft.values !== "object" || Array.isArray(draft.values)
      || (draft.baseSha !== undefined && typeof draft.baseSha !== "string")) return null;
    return draft;
  } catch { return null; }
}

export function entryDraftKey(userId: string, owner: string, repo: string, branch: string, identity: string) {
  return `pages-cms-entry-draft:v1:${JSON.stringify([userId, owner, repo, branch, identity])}`;
}

export const DRAFT_HISTORY_LIMIT = 5;
export function parseEntryDraftHistory(raw: string | null): EntryDraft[] {
  try {
    const values = JSON.parse(raw ?? "[]");
    if (!Array.isArray(values)) return [];
    return values.map((value) => parseEntryDraft(JSON.stringify(value)))
      .filter((draft): draft is EntryDraft => draft !== null).slice(0, DRAFT_HISTORY_LIMIT);
  } catch { return []; }
}

export function moveEntryDraft(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, from: string, to: string, baseSha?: string) {
  if (from === to) return;
  const draft = parseEntryDraft(storage.getItem(from));
  const target = parseEntryDraft(storage.getItem(to));
  const candidates = [target, ...parseEntryDraftHistory(storage.getItem(`${from}:history`)), ...parseEntryDraftHistory(storage.getItem(`${to}:history`))];
  const seen = new Set<string>();
  const history = candidates.filter((item): item is EntryDraft => {
    if (!item) return false;
    const key = JSON.stringify(item.values);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, DRAFT_HISTORY_LIMIT);
  if (draft) storage.setItem(to, JSON.stringify({ ...draft, baseSha: baseSha ?? draft.baseSha }));
  if (history.length) storage.setItem(`${to}:history`, JSON.stringify(history));
  storage.removeItem(from);
  storage.removeItem(`${from}:history`);
}
