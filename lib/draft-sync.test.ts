import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftSync, type ServerDraft } from "./draft-sync";

const row = (version: number, values: Record<string, unknown>): ServerDraft => ({ identity: "post.md", version, values, history: [], savedAt: new Date().toISOString() });
test("five save/edit cycles use confirmed server revisions and never publish", async () => {
  const calls: number[] = [];
  let current = row(2, { body: "old" });
  const sync = createDraftSync({ identity: "post.md", load: async () => current, onLoad() {}, onSaved() {}, write: async (input) => {
    calls.push(input.version); assert.equal(input.version, current.version);
    return current = row(current.version + 1, input.values);
  } });
  await sync.ready;
  await Promise.all(["A", "B", "C", "D", "E"].map((body) => sync.save({ values: { body } })));
  assert.deepEqual(calls, [2, 3, 4, 5, 6]); assert.equal(current.values.body, "E");
});
test("a lost response retries the same request id before saving newer text", async () => {
  const requests: string[] = [];
  let first = true;
  const sync = createDraftSync({ identity: "post.md", load: async () => null, onLoad() {}, onSaved() {}, write: async (input) => {
    requests.push(input.requestId);
    if (first) { first = false; throw new Error("response lost"); }
    return row(input.version + 1, input.values);
  } });
  await assert.rejects(sync.save({ values: { body: "A" } }));
  await sync.save({ values: { body: "B" } });
  assert.equal(requests[0], requests[1]); assert.notEqual(requests[1], requests[2]);
});
test("a conflict prevents subsequent automatic overwrites", async () => {
  let writes = 0;
  const sync = createDraftSync({ identity: "post.md", load: async () => row(1, {}), onLoad() {}, onSaved() {}, write: async () => {
    writes++; throw Object.assign(new Error("conflict"), { status: 409 });
  } });
  await assert.rejects(sync.save({ values: { body: "A" } }));
  await assert.rejects(sync.save({ values: { body: "B" } }));
  assert.equal(writes, 1);
});
test("expired initial session can recover without treating a failed read as an empty draft", async () => {
  let reads = 0; let usedVersion = -1;
  const sync = createDraftSync({ identity: "post.md", load: async () => { if (++reads === 1) throw new Error("expired"); return row(9, { body: "remote" }); }, onLoad() {}, onSaved() {}, write: async (input) => { usedVersion = input.version; return row(10, input.values); } });
  await assert.rejects(sync.ready);
  await sync.save({ values: { body: "local" } });
  assert.equal(usedVersion, 9);
});
test("Postgres JSONB key ordering does not create a different draft", async () => {
  let writes = 0;
  const sync = createDraftSync({ identity: "post.md", load: async () => row(3, { body: "same", title: "same" }), onLoad() {}, onSaved() {}, write: async () => { writes++; throw new Error("unexpected write"); } });
  await sync.save({ values: { title: "same", body: "same" } });
  assert.equal(writes, 0);
});
