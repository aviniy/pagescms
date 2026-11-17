"use client";

import Link from "next/link";
import useSWR from "swr";
import { useUser } from "@/contexts/user-context";
import { Button } from "@/components/ui/button";
import { draftResumeUrl, type DraftListItem } from "@/lib/draft-editor-state";

export function CollectionDrafts({ scope, collectionUrl, titleField }: { scope: string; collectionUrl: string; titleField: string }) {
  const { user } = useUser();
  const url = `/api/drafts?${new URLSearchParams({ list: "1", scope, titleField })}`;
  const { data, error, isLoading, mutate } = useSWR<DraftListItem[]>(user ? [user.id, url] : null, async () => {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "임시 저장한 글을 불러오지 못했어요.");
    return payload.data;
  }, { revalidateOnMount: true });
  if (!user) return null;
  return <section aria-label="임시 저장한 글" className="rounded-md border p-4 space-y-3">
    <div>
      <h2 className="font-semibold">임시 저장한 글</h2>
      <p className="text-sm text-muted-foreground">저장한 글을 열어 이어 쓰고, 완성되면 ‘게시’를 눌러 주세요. 초안은 계정에 비공개로 보관돼요.</p>
    </div>
    {isLoading && <p role="status" className="text-sm text-muted-foreground">저장한 글을 불러오는 중…</p>}
    {error && <div role="alert" className="flex items-center gap-3 text-sm">
      <p>임시 저장한 글을 불러오지 못했어요.</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void mutate()}>다시 불러오기</Button>
    </div>}
    {!isLoading && !error && !data?.length && <p className="text-sm text-muted-foreground">아직 임시 저장한 글이 없어요. 새 글 작성 화면에서 ‘저장’을 눌러 주세요.</p>}
    {Boolean(data?.length) && <ul className="divide-y">
      {[...(data ?? [])].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)).map((draft) => <li key={draft.identity}>
        <Link href={draftResumeUrl(collectionUrl, draft)} className="flex flex-wrap items-center justify-between gap-2 rounded-sm py-3 hover:underline">
          <span className="min-w-0 break-words">{draft.title || draft.path || "제목 없는 새 글"}</span>
          <span className="text-xs text-muted-foreground">{draft.path ? "수정 이어쓰기" : "새 글 이어쓰기"} · {new Date(draft.savedAt).toLocaleString("ko-KR")}</span>
        </Link>
      </li>)}
    </ul>}
  </section>;
}
