export type DraftEditorState = { filename: string; parent?: string };
const editorKey = "__pagesCmsDraftEditor";

// Editor settings travel with private drafts, never with published content.
export function packDraftValues(values: Record<string, unknown>, editor?: DraftEditorState) {
  return editor ? { ...values, [editorKey]: { version: 1, ...editor } } : values;
}
export function unpackDraftValues(stored: Record<string, unknown>) {
  const metadata = stored[editorKey];
  if (!metadata || typeof metadata !== "object" || !("version" in metadata) || metadata.version !== 1
    || !("filename" in metadata) || typeof metadata.filename !== "string") return { values: stored, editor: undefined };
  const { [editorKey]: _editor, ...values } = stored;
  const editor: DraftEditorState = { filename: metadata.filename };
  if ("parent" in metadata && typeof metadata.parent === "string") editor.parent = metadata.parent;
  return { values, editor };
}

export type DraftListItem = { identity: string; path: string | null; title: string | null; parent: string | null; savedAt: string; requestId: string };
export function draftResumeUrl(collectionUrl: string, draft: DraftListItem) {
  const query = new URLSearchParams({ draft: draft.identity });
  if (!draft.path && draft.parent) query.set("parent", draft.parent);
  return `${collectionUrl}/${draft.path ? `edit/${encodeURIComponent(draft.path)}` : "new"}?${query}`;
}
