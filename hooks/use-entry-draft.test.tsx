import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useForm, type UseFormReturn, type FieldValues } from "react-hook-form";
import { useEntryDraft } from "./use-entry-draft";
import { entryDraftKey, parseEntryDraft } from "../lib/entry-draft";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://cms.example" });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const key = entryDraftKey("user", "owner", "repo", "main", "post.md");
let form: UseFormReturn<FieldValues>;
let draft: ReturnType<typeof useEntryDraft>;
function Harness() {
  const currentForm = useForm<FieldValues>({ defaultValues: { body: "server", title: "title" } });
  const currentDraft = useEntryDraft(currentForm, key, "sha");
  useEffect(() => {
    form = currentForm;
    draft = currentDraft;
  }, [currentForm, currentDraft]);
  return null;
}
async function mount() {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  return root;
}

test("unsaved text survives immediate reload and failed save, successful save clears it", async () => {
  window.localStorage.clear();
  let root = await mount();
  await act(async () => form.setValue("body", "![image](/images/a.png)\n\n```c\nint x;\n```", { shouldDirty: true }));
  const stored = parseEntryDraft(window.localStorage.getItem(key))!;
  assert.equal(stored.values.body, form.getValues("body"));
  await act(async () => root.unmount());
  root = await mount();
  assert.deepEqual(draft.recovery?.values, stored.values);
  await act(async () => draft.restore());
  assert.equal(form.getValues("body"), stored.values.body);
  assert.ok(window.localStorage.getItem(key)); // No successful server response yet.
  await act(async () => draft.saved(form.getValues()));
  assert.equal(window.localStorage.getItem(key), null);
  await act(async () => root.unmount());
  assert.equal(window.localStorage.getItem(key), null);
});

test("a successful save cannot erase edits typed while the request was running", async () => {
  window.localStorage.clear();
  const root = await mount();
  await act(async () => form.setValue("body", "submitted", { shouldDirty: true }));
  const submitted = { ...form.getValues() };
  await act(async () => form.setValue("body", "newer unsaved text", { shouldDirty: true }));
  await act(async () => draft.saved(submitted));
  assert.equal(parseEntryDraft(window.localStorage.getItem(key))?.values.body, "newer unsaved text");
  await act(async () => root.unmount());
});

test("reverting all edits removes the obsolete recovery draft", async () => {
  window.localStorage.clear();
  const root = await mount();
  await act(async () => form.setValue("body", "temporary edit", { shouldDirty: true }));
  assert.ok(window.localStorage.getItem(key));
  await act(async () => form.setValue("body", "server", { shouldDirty: true }));
  assert.equal(window.localStorage.getItem(key), null);
  await act(async () => root.unmount());
});

test("drafts are scoped to account, branch and file and invalid storage is ignored", () => {
  assert.notEqual(key, entryDraftKey("other", "owner", "repo", "main", "post.md"));
  assert.notEqual(key, entryDraftKey("user", "owner", "repo", "dev", "post.md"));
  assert.notEqual(key, entryDraftKey("user", "owner", "repo", "main", "other.md"));
  assert.equal(parseEntryDraft("{broken"), null);
  assert.equal(parseEntryDraft('{"version":1,"savedAt":0,"values":[]}'), null);
});

test("automatic checkpoints survive reload and recover a large accidental deletion", async () => {
  window.localStorage.clear();
  let root = await mount();
  const body = "작성 중인 라이트업\n".repeat(60);
  await act(async () => form.setValue("body", body, { shouldDirty: true }));
  await act(async () => form.setValue("body", "", { shouldDirty: true }));
  assert.ok(draft.history.some((version) => version.values.body === body));
  assert.ok(draft.lastSavedAt);
  await act(async () => root.unmount());
  root = await mount();
  const previous = draft.history.find((version) => version.values.body === body)!;
  await act(async () => draft.restore(previous));
  assert.equal(form.getValues("body"), body);
  assert.equal(parseEntryDraft(window.localStorage.getItem(key))?.values.body, body);
  await act(async () => root.unmount());
});

test("storage failure is visible while the editable values remain available for backup", async () => {
  window.localStorage.clear();
  const root = await mount();
  const proto = Object.getPrototypeOf(window.localStorage);
  const original = proto.setItem;
  proto.setItem = () => { throw new Error("quota exceeded"); };
  try {
    await act(async () => form.setValue("body", "must survive", { shouldDirty: true }));
    assert.equal(draft.storageFailed, true);
    assert.equal(form.getValues("body"), "must survive");
    const reload = new window.Event("beforeunload", { cancelable: true });
    await act(async () => { window.dispatchEvent(reload); });
    assert.equal(reload.defaultPrevented, true);
  } finally {
    proto.setItem = original;
    await act(async () => root.unmount());
  }
});
