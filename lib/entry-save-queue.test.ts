import assert from "node:assert/strict";
import { test } from "node:test";
import { createEntrySaveQueue } from "./entry-save-queue";

test("save, edit, save, edit, save always uses the previous successful file SHA", async () => {
  const writes: unknown[] = [];
  const session = createEntrySaveQueue<{ body: string }>({
    persist: async (snapshot, base) => {
      writes.push({ ...base, body: snapshot.body });
      return { path: "post.md", sha: `sha-${snapshot.body}` };
    }, onSaved() {}, onBusyChange() {},
  });
  session.adoptRemote({ path: "post.md", sha: "original" }, session.epoch);
  for (const body of ["first", "second", "third"]) await session.enqueue({ body });
  assert.deepEqual(writes, [
    { path: "post.md", sha: "original", body: "first" },
    { path: "post.md", sha: "sha-first", body: "second" },
    { path: "post.md", sha: "sha-second", body: "third" },
  ]);
});

test("edits submitted during a save run in order, immutable snapshots and duplicate clicks are safe", async () => {
  const writes: unknown[] = [];
  let release!: () => void;
  const pause = new Promise<void>((resolve) => { release = resolve; });
  const session = createEntrySaveQueue<{ nested: { body: string } }>({
    persist: async (snapshot, base) => {
      writes.push({ ...base, body: snapshot.nested.body });
      if (snapshot.nested.body === "first") await pause;
      return { path: "created.md", sha: snapshot.nested.body };
    }, onSaved() {}, onBusyChange() {},
  });
  const values = { nested: { body: "first" } };
  const first = session.enqueue(values);
  assert.equal(first, session.enqueue(values));
  values.nested.body = "second";
  const second = session.enqueue(values);
  values.nested.body = "not submitted";
  release();
  await Promise.all([first, second]);
  assert.deepEqual(writes, [
    { body: "first" },
    { path: "created.md", sha: "first", body: "second" },
  ]);
  assert.equal(session.busy, false);
});

test("late reads from before/during a save cannot regress the confirmed file version", async () => {
  let release!: () => void;
  const pause = new Promise<void>((resolve) => { release = resolve; });
  const session = createEntrySaveQueue<string>({
    persist: async () => { await pause; return { path: "post.md", sha: "new" }; },
    onSaved() {}, onBusyChange() {},
  });
  const oldRead = session.epoch;
  session.adoptRemote({ path: "post.md", sha: "old" }, oldRead);
  const saving = session.enqueue("new text");
  await Promise.resolve();
  const duringRead = session.epoch;
  release();
  await saving;
  assert.equal(session.adoptRemote({ path: "post.md", sha: "old" }, oldRead), false);
  assert.equal(session.adoptRemote({ path: "post.md", sha: "old" }, duringRead, true), false);
  assert.equal(session.base.sha, "new");
});

test("save failure preserves the confirmed version and allows a later retry", async () => {
  let fail = true;
  const session = createEntrySaveQueue<string>({
    persist: async (_snapshot, base) => {
      assert.equal(base.sha, "old");
      if (fail) throw Object.assign(new Error("login expired"), { status: 401 });
      return { path: "post.md", sha: "new" };
    }, onSaved() {}, onBusyChange() {},
  });
  session.adoptRemote({ path: "post.md", sha: "old" }, session.epoch);
  await assert.rejects(session.enqueue("latest text"), { status: 401 });
  assert.equal(session.base.sha, "old");
  fail = false;
  await session.enqueue("latest text");
  assert.equal(session.base.sha, "new");
});
