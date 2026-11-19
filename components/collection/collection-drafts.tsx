"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useUser } from "@/contexts/user-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { draftResumeUrl, type DraftListItem } from "@/lib/draft-editor-state";

export function CollectionDrafts({ scope, collectionUrl, titleField }: { scope: string; collectionUrl: string; titleField: string }) {
  const { user } = useUser();
  const [deleting, setDeleting] = useState(false);
  const url = `/api/drafts?${new URLSearchParams({ list: "1", scope, titleField })}`;
  const { data, error, isLoading, mutate } = useSWR<DraftListItem[]>(user ? [user.id, url] : null, async () => {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "임시 저장한 글을 불러오지 못했어요.");
    return payload.data;
  }, { revalidateOnMount: true });
  if (!user) return null;

  async function deleteDraft(draft: DraftListItem) {
    setDeleting(true);
    try {
      const response = await fetch("/api/drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, identity: draft.identity, requestId: draft.requestId }),
      });
      if (response.status === 409) {
        toast.error("다른 탭에서 초안이 변경됐어요. 최신 내용을 확인해 주세요.");
        await mutate();
      } else if (response.status === 401) {
        toast.error("로그인이 만료됐어요. 다시 로그인한 뒤 삭제해 주세요.");
      } else if (response.status === 204) {
        await mutate((drafts) => drafts?.filter((item) => item.identity !== draft.identity));
        toast.success("서버 초안을 삭제했어요.");
      } else {
        throw new Error("Draft deletion failed");
      }
    } catch {
      toast.error("요청을 완료하지 못했어요. 목록을 다시 불러와 확인해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

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
      {[...(data ?? [])].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)).map((draft) => {
        const title = draft.title || draft.path || "제목 없는 새 글";
        const savedAt = new Date(draft.savedAt).toLocaleString("ko-KR");
        return <li key={draft.identity} className="flex items-center gap-3">
          <Link href={draftResumeUrl(collectionUrl, draft)} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 rounded-sm py-3 hover:underline">
            <span className="min-w-0 break-words">{title}</span>
            <span className="text-xs text-muted-foreground">{draft.path ? "수정 이어쓰기" : "새 글 이어쓰기"} · {savedAt}</span>
          </Link>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={deleting} aria-label={`${title} 초안 삭제 (${savedAt})`}>삭제</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>임시 저장한 글을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  {savedAt}에 저장한 ‘{title}’ 초안의 서버 저장본과 수정 기록을 삭제해요.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void deleteDraft(draft)}>초안 삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </li>;
      })}
    </ul>}
  </section>;
}
