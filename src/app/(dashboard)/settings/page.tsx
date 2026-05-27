import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { merchants, users } from "@/lib/db/schema";
import { getServerEnv } from "@/lib/config";
import type { NaverPlaceData } from "@/lib/naver/place";
import { formatKRW } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ROLE_STYLE: Record<string, string> = {
  owner: "bg-amber-100 text-amber-700",
  manager: "bg-emerald-100 text-emerald-700",
  staff: "bg-slate-100 text-slate-600",
};

function mask(s: string | undefined | null, visible = 4): string {
  if (!s) return "(미설정)";
  if (s.length <= visible) return "•".repeat(s.length);
  return `${s.slice(0, visible)}${"•".repeat(Math.max(4, s.length - visible))}`;
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner") {
    return (
      <div className="space-y-2">
        <h1 className="font-serif text-2xl font-semibold">설정</h1>
        <p className="text-sm text-muted-foreground">owner 권한만 접근 가능합니다.</p>
      </div>
    );
  }

  const env = getServerEnv();

  // 매장 정보 — 네이버 플레이스 캐시
  const merchantId = env.TOSS_MERCHANT_ID ? Number(env.TOSS_MERCHANT_ID) : null;
  const merchantRow = merchantId
    ? (
        await db
          .select({
            id: merchants.id,
            name: merchants.name,
            naverPlaceId: merchants.naverPlaceId,
            naverData: merchants.naverData,
            naverFetchedAt: merchants.naverFetchedAt,
          })
          .from(merchants)
          .where(sql`${merchants.id} = ${merchantId}`)
          .limit(1)
      )[0]
    : null;
  const naver = (merchantRow?.naverData ?? null) as NaverPlaceData | null;

  // 사용자 목록
  const userList = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      kakaoId: users.kakaoId,
      googleId: users.googleId,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(sql`${users.role}`, sql`${users.id}`);

  // 데이터 신선도
  const freshness = await db.execute<{
    last_order: string | null;
    total_orders: string;
    total_revenue: string;
  }>(sql`
    SELECT
      to_char(MAX(completed_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS last_order,
      COUNT(*)::bigint AS total_orders,
      COALESCE(SUM(total_amount), 0)::bigint AS total_revenue
    FROM orders WHERE order_state = 'COMPLETED'
  `);
  const f = freshness[0];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-semibold">설정</h1>
        <p className="text-sm text-muted-foreground">매장·사용자·연동 상태 관리</p>
      </header>

      {/* 매장 정보 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">🏪 매장</h2>
        <dl className="grid grid-cols-1 gap-y-3 text-sm md:grid-cols-2">
          <Row label="상호">니드 베이커스</Row>
          <Row label="주소">서울 동작구 상도동 (상도역 1번 출구)</Row>
          <Row label="토스 가맹점 ID">{env.TOSS_MERCHANT_ID ?? "(미설정)"}</Row>
          <Row label="기본 시간대">Asia/Seoul (KST)</Row>
        </dl>
      </section>

      {/* 네이버 플레이스 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-semibold">🟢 네이버 플레이스</h2>
          {merchantRow?.naverFetchedAt && (
            <span className="text-[11px] text-muted-foreground">
              마지막 동기화: {new Date(merchantRow.naverFetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
            </span>
          )}
        </div>
        {naver ? (
          <>
            <dl className="grid grid-cols-1 gap-y-3 text-sm md:grid-cols-2">
              <Row label="매장명">{naver.name}</Row>
              <Row label="카테고리">{naver.category ?? "—"}</Row>
              <Row label="주소">{naver.address ?? "—"}</Row>
              <Row label="도로명">{naver.roadAddress ?? "—"}</Row>
              <Row label="네이버 Place ID">
                <a
                  href={`https://m.place.naver.com/restaurant/${naver.placeId}/home`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {naver.placeId} ↗
                </a>
              </Row>
              <Row label="지하철">
                {naver.subwayStations.length > 0
                  ? naver.subwayStations.map((s) => `${s.name} (${s.line})`).join(", ")
                  : "—"}
              </Row>
            </dl>

            {/* 리뷰 통계 */}
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="방문자 리뷰" value={naver.visitorReviewsTotal} />
              <Metric label="텍스트 리뷰" value={naver.visitorReviewsTextTotal} />
              <Metric
                label="사진 리뷰"
                value={naver.visitorReviewsMediaTotal}
              />
              <Metric label="블로그 리뷰" value={naver.blogReviewsTotal} />
            </div>

            {/* 키워드 */}
            {naver.keywords.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  네이버 자동 키워드
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {naver.keywords.map((k) => (
                    <span
                      key={k}
                      className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 border border-amber-200"
                    >
                      #{k}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 메뉴 미리보기 */}
            {naver.menu.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    메뉴 ({naver.menu.length}개)
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5 text-xs md:grid-cols-2 lg:grid-cols-3">
                  {naver.menu.slice(0, 18).map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5"
                    >
                      <span className="truncate">{m.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {m.price ? formatKRW(m.price) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {naver.menu.length > 18 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {naver.menu.length - 18}개 더…
                  </p>
                )}
              </div>
            )}

            <p className="mt-5 text-[11px] text-muted-foreground">
              동기화: 터미널에서 <code className="rounded bg-muted px-1 py-0.5">npm run sync:naver-place</code>{" "}
              (추후 cron 통합 예정)
            </p>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
            아직 동기화 안 됨. 터미널에서 <code className="rounded bg-muted px-1 py-0.5">npm run sync:naver-place</code> 실행.
          </div>
        )}
      </section>

      {/* 토스 연동 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">🔗 토스플레이스 Open API 연동</h2>
        <dl className="grid grid-cols-1 gap-y-3 text-sm md:grid-cols-2">
          <Row label="Base URL">{env.TOSS_BASE_URL}</Row>
          <Row label="Access Key">{mask(env.TOSS_ACCESS_KEY, 6)}</Row>
          <Row label="Secret Key">{mask(env.TOSS_SECRET_KEY, 0)}</Row>
          <Row label="Webhook Secret">{mask(env.TOSS_WEBHOOK_SECRET, 0)}</Row>
        </dl>
        <p className="mt-4 text-[11px] text-muted-foreground">
          키 갱신은 토스 개발자센터에서 새 인증 정보를 만든 후 환경변수(`TOSS_ACCESS_KEY`, `TOSS_SECRET_KEY`) 교체.
        </p>
      </section>

      {/* 데이터 신선도 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">📊 데이터 적재 현황</h2>
        <dl className="grid grid-cols-1 gap-y-3 text-sm md:grid-cols-3">
          <Row label="최신 주문 시각">{f?.last_order ?? "—"}</Row>
          <Row label="누적 완료 주문">
            {Number(f?.total_orders ?? 0).toLocaleString()} 건
          </Row>
          <Row label="누적 매출">
            ₩{Number(f?.total_revenue ?? 0).toLocaleString()}
          </Row>
        </dl>
        <p className="mt-4 text-[11px] text-muted-foreground">
          데이터 추가 적재: 터미널에서 <code className="rounded bg-muted px-1 py-0.5">npm run backfill -- --from YYYY-MM-DD --to YYYY-MM-DD</code>
        </p>
      </section>

      {/* 사용자 관리 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-semibold">👥 사용자</h2>
          <span className="text-xs text-muted-foreground">{userList.length}명</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">이름</th>
              <th className="py-2 font-normal">이메일</th>
              <th className="py-2 font-normal">권한</th>
              <th className="py-2 font-normal">제공자</th>
              <th className="py-2 font-normal">마지막 로그인</th>
            </tr>
          </thead>
          <tbody>
            {userList.map((u) => (
              <tr key={u.id} className="border-b border-border/40 last:border-0">
                <td className="py-2.5">
                  <div className="font-medium">{u.name ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">id={u.id}</div>
                </td>
                <td className="py-2.5 text-xs">{u.email ?? "—"}</td>
                <td className="py-2.5">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_STYLE[u.role] ?? "bg-slate-100"}`}
                  >
                    {u.role}
                  </span>
                  {!u.isActive && (
                    <span className="ml-1 text-[10px] text-muted-foreground">(비활성)</span>
                  )}
                </td>
                <td className="py-2.5 text-xs text-muted-foreground">
                  {u.kakaoId && "카카오"}
                  {u.kakaoId && u.googleId && " + "}
                  {u.googleId && "Google"}
                </td>
                <td className="py-2.5 text-xs tabular-nums text-muted-foreground">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 16).replace("T", " ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-[11px] text-muted-foreground">
          새 사용자: 해당 계정으로 로그인 시도 시 화이트리스트(`OWNER_KAKAO_EMAILS`, `OWNER_GOOGLE_EMAILS`)에 추가하거나, 이메일이 기존 사용자와 매칭되면 자동 링크됩니다.
        </p>
      </section>

      {/* AI / 알림 (선택) */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">🤖 AI / 알림 (선택)</h2>
        <dl className="grid grid-cols-1 gap-y-3 text-sm md:grid-cols-2">
          <Row label="Anthropic API Key">{mask(env.ANTHROPIC_API_KEY, 0)}</Row>
          <Row label="Anthropic Model">{env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5"}</Row>
          <Row label="Slack Webhook">{env.SLACK_WEBHOOK_URL ? "설정됨" : "미설정"}</Row>
          <Row label="Resend (이메일)">{env.RESEND_API_KEY ? "설정됨" : "미설정"}</Row>
        </dl>
        <p className="mt-4 text-[11px] text-muted-foreground">
          ANTHROPIC_API_KEY가 비어 있으면 운영 인사이트는 룰 기반으로 동작합니다.
        </p>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all">{children}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
