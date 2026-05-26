"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/db/schema";

type NavItem = { href: string; label: string; emoji: string; roles?: UserRole[] };

const NAV: NavItem[] = [
  { href: "/", label: "대시보드", emoji: "🏠" },
  { href: "/sales", label: "매출", emoji: "📈", roles: ["owner", "manager"] },
  { href: "/products", label: "상품", emoji: "🥐", roles: ["owner", "manager"] },
  { href: "/channels", label: "채널", emoji: "🛵", roles: ["owner", "manager"] },
  { href: "/payments", label: "결제", emoji: "💳", roles: ["owner", "manager"] },
  { href: "/orders", label: "주문", emoji: "🧾", roles: ["owner", "manager"] },
  { href: "/settings", label: "설정", emoji: "⚙️", roles: ["owner"] },
];

export type SidebarUser = {
  name: string | null;
  role: UserRole;
  imageUrl: string | null;
};

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const visible = NAV.filter((item) => !item.roles || item.roles.includes(user.role));
  const [open, setOpen] = useState(false);

  // 경로 바뀌면 모바일 드로어 자동 닫기
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // 드로어 열렸을 때 body scroll 잠금 (모바일에서만)
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  return (
    <>
      {/* 모바일 — 햄버거 버튼 (좌상단 고정) */}
      <button
        type="button"
        aria-label="메뉴 열기"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-30 grid h-10 w-10 place-items-center rounded-md border border-border bg-card text-lg shadow-sm md:hidden"
      >
        ☰
      </button>

      {/* 모바일 — 오버레이 (탭하면 닫힘) */}
      {open && (
        <button
          type="button"
          aria-label="메뉴 닫기"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      {/* 사이드바 본체 — 데스크탑: static, 모바일: 슬라이드 드로어 */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-64 shrink-0 flex-col border-r border-border bg-card transition-transform duration-200 ease-out",
          "md:static md:w-60 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🌾</span>
            <div className="leading-tight">
              <div className="font-serif text-base font-semibold">KNEAD</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Analytics
              </div>
            </div>
          </div>
          {/* 모바일 닫기 버튼 */}
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
            className="grid h-8 w-8 place-items-center rounded-md text-sm text-muted-foreground hover:bg-muted md:hidden"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {visible.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors md:py-2",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-secondary hover:text-foreground",
                )}
              >
                <span className="text-base">{item.emoji}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} src={user.imageUrl} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user.name ?? "익명"}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {user.role}
              </div>
            </div>
          </div>
          <form action="/api/auth/signout" method="post" className="mt-3">
            <button
              type="submit"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground/80 hover:bg-secondary"
            >
              로그아웃
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function Avatar({ name, src }: { name: string | null; src: string | null }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name ?? "user"}
        className="h-8 w-8 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  const initial = name?.[0]?.toUpperCase() ?? "?";
  return (
    <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
      {initial}
    </div>
  );
}
