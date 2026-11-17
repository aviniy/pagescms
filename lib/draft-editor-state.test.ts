import assert from "node:assert/strict";
import { test } from "node:test";
import { packDraftValues, unpackDraftValues, draftResumeUrl } from "./draft-editor-state";

test("saving and reopening keeps content, filename and folder without publishing editor metadata", () => {
  const values = { title: "초안", body: "```c\nint x;\n```\n![그림](/images/test.png)" };
  const editor = { filename: "my-post.md", parent: "src/content/posts/sub folder" };
  const stored = JSON.parse(JSON.stringify(packDraftValues(values, editor)));
  const reopened = unpackDraftValues(stored);
  assert.deepEqual(reopened, { values, editor });
  assert.deepEqual(values, unpackDraftValues(packDraftValues(reopened.values, editor)).values);
  assert.equal("__pagesCmsDraftEditor" in reopened.values, false);
});
test("old drafts without editor settings still reopen", () => {
  assert.deepEqual(unpackDraftValues({ body: "old" }), { values: { body: "old" }, editor: undefined });
});
test("resume links keep a new draft's identity and folder and use the saved path after publication", () => {
  const draft = { identity: "draft&id", path: null, parent: "posts/한국어 #", title: "title", savedAt: "" };
  const fresh = new URL(draftResumeUrl("/owner/repo/main/collection/posts", draft), "https://cms.example");
  assert.equal(fresh.pathname, "/owner/repo/main/collection/posts/new");
  assert.equal(fresh.searchParams.get("draft"), draft.identity);
  assert.equal(fresh.searchParams.get("parent"), draft.parent);
  const existing = new URL(draftResumeUrl("/owner/repo/main/collection/posts", { ...draft, path: "posts/a #.md" }), "https://cms.example");
  assert.ok(existing.pathname.endsWith("/edit/posts%2Fa%20%23.md"));
  assert.equal(existing.searchParams.get("draft"), draft.identity);
  assert.equal(existing.searchParams.has("parent"), false);
});
