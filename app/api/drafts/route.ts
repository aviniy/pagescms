import { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUserSession } from "@/lib/session-server";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import { readServerDraft, writeServerDraft } from "@/lib/server-entry-draft";

const addressSchema = z.object({
  scope: z.string().min(1).max(1500), identity: z.string().min(1).max(1500), path: z.string().max(1500).optional(),
});
const writeSchema = addressSchema.extend({
  version: z.number().int().min(0), requestId: z.string().uuid(),
  values: z.record(z.unknown()), baseSha: z.string().max(128).optional(),
});
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiUserSession();
    if ("response" in session) return session.response;
    const address = addressSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json({ data: await readServerDraft(session.user.id, address) }, { headers });
  } catch (error) { return toErrorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) throw createHttpError("Invalid origin", 403);
    const session = await requireApiUserSession();
    if ("response" in session) return session.response;
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2_000_000) throw createHttpError("초안 크기가 너무 커요. 초안 백업으로 보관해 주세요.", 413);
    const { scope, identity, path, ...input } = writeSchema.parse(JSON.parse(raw));
    return Response.json({ data: await writeServerDraft(session.user.id, { scope, identity, path }, input) }, { headers });
  } catch (error) { return toErrorResponse(error); }
}
