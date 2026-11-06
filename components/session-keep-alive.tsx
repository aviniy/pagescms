"use client";

import { usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-client";

export function SessionKeepAlive() {
  // Mount the shared session subscription so Better Auth's polling, focus and
  // reconnect handlers can renew the cookie while the editor stays open.
  const { data, error, isPending } = useSession();
  const pathname = usePathname();
  if (isPending || (data && !error)) return null;
  const expired = !error || error.status === 401;
  return (
    <aside role="alert" className="fixed right-4 bottom-4 z-40 max-w-sm rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
      <p>{expired ? "로그인이 만료됐어요. 편집창을 닫지 않고 다시 로그인할 수 있어요." : "로그인 연결을 확인하지 못했어요. 인터넷 연결을 확인해 주세요."}</p>
      <p className="mt-1 text-muted-foreground">초안 자동 보관 상태를 확인하고 계속 작성해 주세요.</p>
      {expired && <a className="mt-2 inline-block underline" href={`/sign-in?redirect=${encodeURIComponent(pathname)}`} target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>}
    </aside>
  );
}
