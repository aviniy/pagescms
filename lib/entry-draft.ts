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
