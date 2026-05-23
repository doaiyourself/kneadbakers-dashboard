"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="text-2xl">🌾</span>
        <div className="leading-tight">
          <div className="font-serif text-base font-semibold">KNEAD</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Analytics
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {visible.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
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
