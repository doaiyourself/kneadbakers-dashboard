/**
 * 네이버 플레이스 정보를 끌어와서 merchants.naver_data 에 저장.
 *
 * 실행:
 *   npm run sync:naver-place
 *
 * merchants.naver_place_id 가 등록된 매장만 처리.
 */
import "dotenv/config";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../lib/db/client";
import { merchants } from "../lib/db/schema";
import { fetchNaverPlace } from "../lib/naver/place";

async function main() {
  const rows = await db
    .select({ id: merchants.id, name: merchants.name, placeId: merchants.naverPlaceId })
    .from(merchants)
    .where(isNotNull(merchants.naverPlaceId));

  if (rows.length === 0) {
    console.log("등록된 naver_place_id 가 없습니다.");
    process.exit(0);
  }

  for (const m of rows) {
    if (!m.placeId) continue;
    console.log(`\n— ${m.name} (id=${m.id}, placeId=${m.placeId})`);
    try {
      const data = await fetchNaverPlace(m.placeId);
      console.log(`  ✓ name=${data.name} cat=${data.category}`);
      console.log(`    keywords=[${data.keywords.join(", ")}]`);
      console.log(
        `    visitor=${data.visitorReviewsTotal} (text=${data.visitorReviewsTextTotal}, media=${data.visitorReviewsMediaTotal})`,
      );
      console.log(`    blog=${data.blogReviewsTotal}, menu=${data.menu.length}개, station=${data.subwayStations.length}`);
      if (data.menu.length > 0) {
        console.log("    메뉴 미리보기:");
        for (const item of data.menu.slice(0, 5)) {
          console.log(`      • ${item.name} ${item.price ? `₩${item.price.toLocaleString()}` : "(가격없음)"}`);
        }
      }

      await db
        .update(merchants)
        .set({
          naverData: data as unknown as Record<string, unknown>,
          naverFetchedAt: new Date(),
        })
        .where(eq(merchants.id, m.id));
      console.log("  ✓ DB 저장 완료");
    } catch (e) {
      console.error("  ✗ 실패:", e);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
