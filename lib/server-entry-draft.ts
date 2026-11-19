import { and, eq, or, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { entryDraftTable as drafts } from "@/db/schema";
import { createHttpError } from "@/lib/api-error";
import { draftFingerprint } from "@/lib/draft-sync";

export type DraftAddress = { scope: string; identity: string; path?: string };
export async function listServerDrafts(userId: string, scope: string, titleField = "title") {
  // The list needs summaries, not full bodies or checkpoint histories.
  return db.selectDistinctOn([sql`coalesce(${drafts.path}, ${drafts.identity})`], {
    identity: drafts.identity, path: drafts.path, savedAt: drafts.savedAt, requestId: drafts.requestId,
    title: sql<string | null>`${drafts.values} ->> ${titleField}`,
    parent: sql<string | null>`${drafts.values} -> '__pagesCmsDraftEditor' ->> 'parent'`,
  }).from(drafts).where(and(eq(drafts.userId, userId), eq(drafts.scope, scope)))
    .orderBy(sql`coalesce(${drafts.path}, ${drafts.identity})`, desc(drafts.savedAt));
}

export async function deleteServerDraft(userId: string, address: Pick<DraftAddress, "scope" | "identity">, requestId: string) {
  const matchesDraft = and(eq(drafts.userId, userId), eq(drafts.scope, address.scope), eq(drafts.identity, address.identity));
  // Match the revision in the list so a save from another tab cannot be erased.
  const [deleted] = await db.delete(drafts).where(and(matchesDraft, eq(drafts.requestId, requestId))).returning({ id: drafts.id });
  if (deleted) return;
  const [current] = await db.select({ id: drafts.id }).from(drafts).where(matchesDraft).limit(1);
  if (current) throw createHttpError("다른 탭에서 초안이 변경됐어요. 최신 내용을 확인해 주세요.", 409);
}

export async function readServerDraft(userId: string, address: DraftAddress) {
  const [row] = await db.select().from(drafts).where(and(
    eq(drafts.userId, userId), eq(drafts.scope, address.scope),
    address.path ? or(eq(drafts.identity, address.identity), eq(drafts.path, address.path)) : eq(drafts.identity, address.identity),
  )).orderBy(desc(drafts.savedAt)).limit(1);
  return row ?? null;
}

export async function writeServerDraft(userId: string, address: DraftAddress, input: {
  version: number; requestId: string; values: Record<string, unknown>; baseSha?: string;
}) {
  return db.transaction(async (tx) => {
    // Serialize creation and updates even when two tabs submit the first revision together.
    const { sql } = await import("drizzle-orm");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([userId, address.scope, address.identity])}, 0))`);
    const [current] = await tx.select().from(drafts).where(and(eq(drafts.userId, userId), eq(drafts.scope, address.scope), eq(drafts.identity, address.identity))).for("update");
    if (current?.requestId === input.requestId) return current;
    if ((current?.version ?? 0) !== input.version) throw createHttpError("다른 탭에서 초안이 변경됐어요. 현재 내용은 브라우저에 보관했어요. 초안을 백업한 뒤 새로고침해 비교해 주세요.", 409);
    const savedAt = new Date();
    if (!current) {
      const [created] = await tx.insert(drafts).values({ id: randomUUID(), userId, ...address, ...input, version: 1, savedAt }).returning();
      return created;
    }
    const history = draftFingerprint(current.values) === draftFingerprint(input.values) ? current.history
      : [{ values: current.values, savedAt: current.savedAt.getTime() }, ...current.history].slice(0, 5);
    const [updated] = await tx.update(drafts).set({
      values: input.values, requestId: input.requestId, version: current.version + 1, history, savedAt,
      path: address.path ?? current.path, baseSha: input.baseSha ?? current.baseSha,
    }).where(eq(drafts.id, current.id)).returning();
    return updated;
  });
}
