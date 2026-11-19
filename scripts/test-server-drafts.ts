import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { userTable } from "../db/schema";

async function main() {
  if (!process.env.DRAFT_TEST_DATABASE_URL) throw new Error("Set DRAFT_TEST_DATABASE_URL to an isolated test branch connection string.");
  process.env.DATABASE_URL = process.env.DRAFT_TEST_DATABASE_URL;
  const { db } = await import("../db");
  const { deleteServerDraft, listServerDrafts, readServerDraft, writeServerDraft } = await import("../lib/server-entry-draft");
  const a = `draft-test-${randomUUID()}`, b = `draft-test-${randomUUID()}`;
  await db.insert(userTable).values([a, b].map((id) => ({ id, name: "Draft integration test", email: `${id}@example.invalid` })));
  try {
    const address = { scope: JSON.stringify(["test", "repo", "main", "posts"]), identity: "post.md", path: "post.md" };
    let version = 0;
    let lastId = "";
    for (const body of ["A", "B", "C", "D", "E"]) {
      lastId = randomUUID();
      const saved = await writeServerDraft(a, address, { version, requestId: lastId, values: { body } });
      assert.equal(saved.version, ++version);
    }
    assert.equal((await readServerDraft(a, address))?.values.body, "E");
    assert.equal(await readServerDraft(b, address), null);
    assert.equal((await listServerDrafts(a, address.scope)).length, 1);
    assert.equal((await listServerDrafts(b, address.scope)).length, 0);
    assert.equal((await listServerDrafts(a, "different-scope")).length, 0);
    const replay = await writeServerDraft(a, address, { version: 4, requestId: lastId, values: { body: "E" } });
    assert.equal(replay.version, 5);
    await assert.rejects(writeServerDraft(a, address, { version: 4, requestId: randomUUID(), values: { body: "stale" } }), (e: unknown) => (e as { status: number }).status === 409);
    const simultaneous = await Promise.allSettled(["tab-A", "tab-B"].map((body) => writeServerDraft(a, address, { version: 5, requestId: randomUUID(), values: { body } })));
    assert.equal(simultaneous.filter((r) => r.status === "fulfilled").length, 1);
    const saved = await readServerDraft(a, address);
    assert.equal(saved?.version, 6); assert.equal(saved?.history.length, 5);
    if (!saved) throw new Error("Missing saved draft");
    await assert.rejects(deleteServerDraft(a, address, lastId), (e: unknown) => (e as { status: number }).status === 409);
    await deleteServerDraft(b, address, saved.requestId);
    assert.equal((await readServerDraft(a, address))?.requestId, saved.requestId);
    const otherDraft = { ...address, identity: "other-draft" };
    await writeServerDraft(a, otherDraft, { version: 0, requestId: randomUUID(), values: { body: "other draft" } });
    await deleteServerDraft(a, address, saved.requestId);
    await deleteServerDraft(a, address, saved.requestId);
    assert.equal(await readServerDraft(a, { scope: address.scope, identity: address.identity }), null);
    assert.equal((await readServerDraft(a, otherDraft))?.values.body, "other draft");
    console.log("PASS: save, resume, revision and account isolation, concurrency, history, and draft deletion");
  } finally {
    await db.delete(userTable).where(eq(userTable.id, a));
    await db.delete(userTable).where(eq(userTable.id, b));
  }
}
main().then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); });
