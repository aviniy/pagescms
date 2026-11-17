import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { useServerEntryDraft } from "./use-server-entry-draft";
import { packDraftValues, unpackDraftValues } from "../lib/draft-editor-state";
import type { ServerDraft } from "../lib/draft-sync";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://cms.example" });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let form: UseFormReturn<FieldValues>;
let draft: ReturnType<typeof useServerEntryDraft>;
let filename: string;
let rename: (value: string) => void;
function Harness() {
  const currentForm = useForm<FieldValues>({ defaultValues: { title: "", body: "" } });
  void currentForm.formState.isDirty;
  const [currentFilename, setFilename] = useState("untitled");
  const currentDraft = useServerEntryDraft(currentForm, {
    scope: "scope", identity: "new-draft", editorState: { filename: currentFilename, parent: "posts/subfolder" },
    onRestoreEditorState: (editor) => setFilename(editor.filename),
  }, false);
  useEffect(() => { form = currentForm; draft = currentDraft; filename = currentFilename; rename = setFilename; });
  return null;
}
async function mount() {
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Harness />); });
  return root;
}

test("write, save, close, reopen without browser data, edit and save keeps the same private draft", async () => {
  const originalFetch = globalThis.fetch;
  let stored: ServerDraft | null = null;
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    assert.ok(String(input).startsWith("/api/drafts")); // This flow cannot publish a GitHub file.
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      assert.equal(body.identity, "new-draft");
      assert.equal(body.version, stored?.version ?? 0);
      stored = { ...body, version: ++writes, savedAt: new Date().toISOString(), history: [] };
    } else assert.equal(init?.cache, "no-store");
    return Response.json({ data: stored });
  };
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    root = await mount();
    for (let cycle = 1; cycle <= 3; cycle++) {
      await act(async () => {
        rename(`post-${cycle}.md`);
        form.setValue("title", "계속 작성하는 글", { shouldDirty: true });
        form.setValue("body", `revision ${cycle}\n![image](/images/a.png)\n\n\`\`\`c\nint x;\n\`\`\``, { shouldDirty: true });
      });
      const expected = structuredClone(form.getValues());
      await act(async () => { await draft.save(); });
      assert.match(draft.status, /서버 임시저장 완료/);
      assert.deepEqual(unpackDraftValues(stored!.values).values, expected);
      await act(async () => root!.unmount());
      root = undefined;
      window.localStorage.clear();
      root = await mount();
      assert.equal(filename, `post-${cycle}.md`);
      assert.deepEqual(form.getValues(), expected);
      assert.deepEqual(draft.remote?.values, expected);
      assert.equal("__pagesCmsDraftEditor" in form.getValues(), false);
    }
    assert.equal(writes, 3);
  } finally {
    if (root) await act(async () => root!.unmount());
    globalThis.fetch = originalFetch;
  }
});

test("opening a saved draft does not replace text entered while the read was pending", async () => {
  const originalFetch = globalThis.fetch;
  let resolveRead!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>((resolve) => { resolveRead = resolve; });
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    root = await mount();
    await act(async () => { form.setValue("body", "typed while loading", { shouldDirty: true }); });
    await act(async () => resolveRead(Response.json({ data: {
      identity: "new-draft", version: 1, history: [], savedAt: new Date().toISOString(),
      values: packDraftValues({ title: "saved", body: "older server body" }, { filename: "saved.md" }),
    } })));
    assert.equal(form.getValues("body"), "typed while loading");
  } finally {
    if (root) await act(async () => root!.unmount());
    globalThis.fetch = originalFetch;
  }
});
