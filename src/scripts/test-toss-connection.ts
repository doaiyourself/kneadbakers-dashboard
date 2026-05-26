/**
 * 토스 Open API 연결 헬스체크.
 *
 * 실행: `npm run test:toss-connection`
 *
 * 통과 조건:
 *   1) 매장 정보 조회 (auth 검증 + merchantId 일치)
 *   2) 최근 7일 주문 1페이지 (size=5)
 *   3) 카탈로그 상품 1페이지 (size=5)
 *
 * 시간 포맷: ISO + Asia/Seoul offset (검증된 포맷).
 * - 토스는 naive ISO / 날짜 only는 거부 (400)
 * - ISO + offset, ISO Z, epoch ms 는 허용
 */
import "dotenv/config";
import { TossApiError, formatTossDateTime, tossClient } from "../lib/toss/client";
import type { TossCatalogItem, TossOrder } from "../lib/toss/types";

function preview(o: unknown, max = 800): string {
  try {
    const s = JSON.stringify(o, null, 2);
    return s.length > max ? s.slice(0, max) + "\n  …(truncated)" : s;
  } catch {
    return String(o);
  }
}

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  process.stdout.write(`\n— ${label}\n`);
  try {
    const res = await fn();
    console.log("  ✓ OK");
    console.log("  preview:", preview(res));
    return res;
  } catch (err) {
    if (err instanceof TossApiError) {
      console.error(`  ✗ Toss ${err.status} ${err.errorCode ?? ""}`);
      console.error("  body:", preview(err.body));
    } else {
      console.error("  ✗", err);
    }
  }
}

async function main() {
  const env = process.env;
  console.log("[test-toss-connection]");
  console.log("  TOSS_BASE_URL    =", env.TOSS_BASE_URL);
  console.log("  TOSS_MERCHANT_ID =", env.TOSS_MERCHANT_ID);
  console.log("  TOSS_ACCESS_KEY  =", env.TOSS_ACCESS_KEY ? `${env.TOSS_ACCESS_KEY.slice(0, 6)}…` : "(empty)");
  console.log("  TOSS_SECRET_KEY  =", env.TOSS_SECRET_KEY ? "(set)" : "(empty)");

  const client = tossClient();

  // 1) 매장 정보 — 가장 기본 (auth 확인용)
  await step("매장 정보 조회 (/merchants/{merchantId})", () => client.getMerchant());

  // 2) 최근 7일 주문 5건
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const orders = (await step("최근 7일 주문 5건", () =>
    client.listOrders({
      from: formatTossDateTime(from),
      to: formatTossDateTime(now),
      orderStates: ["COMPLETED", "CANCELLED", "OPENED"],
      page: 1,
      size: 5,
      sortOrder: "DESC",
    }),
  )) as TossOrder[] | undefined;

  // 3) 카탈로그 5개
  const items = (await step("카탈로그 상품 5개", () =>
    client.listCatalogItems({ page: 1, size: 5 }),
  )) as TossCatalogItem[] | undefined;

  // 요약
  console.log("\n=== 요약 ===");
  console.log(`주문 ${orders?.length ?? 0}건`);
  if (orders?.[0]) {
    const o = orders[0];
    console.log(`  최신: ${o.id} (${o.source}/${o.orderState}) ${o.createdAt}`);
    const li = o.lineItems?.[0];
    if (li) console.log(`         첫 라인: ${li.item?.title} × ${li.quantity}`);
  }
  console.log(`상품 ${items?.length ?? 0}개`);
  if (items?.[0]) {
    const it = items[0];
    console.log(`  첫번째: ${it.id} ${it.title} (${it.category?.title ?? "-"})`);
  }
  console.log("\n끝.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
