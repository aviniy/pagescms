import { and, eq, or, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { entryDraftTable as drafts } from "@/db/schema";
import { createHttpError } from "@/lib/api-error";
import { draftFingerprint } from "@/lib/draft-sync";

export type DraftAddress = { scope: string; identity: string; path?: string };
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
