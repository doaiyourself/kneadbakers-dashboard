/**
 * 네이버 플레이스 (m.place.naver.com) 스크래퍼.
 *
 * 동작:
 *   1) 모바일 플레이스 페이지 fetch (User-Agent 필요)
 *   2) 페이지 안 `window.__APOLLO_STATE__ = {...}` Apollo cache 추출
 *   3) 정규화된 JSON에서 매장 정보 / 메뉴 / 리뷰 카운트 / 키워드 정형화
 *
 * 비공식 — Naver의 페이지 구조가 바뀌면 깨질 수 있음.
 *   raw payload를 같이 저장해서 추후 디버깅·재파싱 가능하게 함.
 *
 * Rate limit·정중함: 빈번 호출 X. 일 1회 (daily-reconcile cron 끝)나 수동 트리거.
 */

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export interface NaverMenuItem {
  id: string;
  name: string;
  price: number | null;
  description: string | null;
  recommended: boolean;
  imageUrl: string | null;
}

export interface NaverPlaceData {
  placeId: string;
  name: string;
  category: string | null;
  /** 사장님 등록 매장 소개글 */
  description: string | null;
  address: string | null;
  roadAddress: string | null;
  phone: string | null;
  /** 네이버가 자동 추출한 키워드 (예: "상도역카페", "소금빵") */
  keywords: string[];
  /** 영업시간 (배열 — 요일별 또는 일반 형태) */
  hours: unknown;
  /** 방문자 리뷰 수 (텍스트+사진 합산) */
  visitorReviewsTotal: number;
  visitorReviewsTextTotal: number;
  visitorReviewsMediaTotal: number;
  /** 별점 (카페는 보통 0) */
  visitorReviewsScore: number;
  blogReviewsTotal: number;
  /** 영업 상태 */
  businessStatus: string | null;
  /** 메뉴 목록 */
  menu: NaverMenuItem[];
  /** 인근 지하철 */
  subwayStations: { name: string; line: string; distance?: number }[];
  /** 대표 이미지 URL 몇 개 */
  imageUrls: string[];
  /** 다음에 재파싱하기 위한 원본 */
  rawApolloState: Record<string, unknown>;
  fetchedAt: string;
}

export class NaverPlaceFetchError extends Error {
  status?: number;
  constructor(msg: string, status?: number) {
    super(msg);
    this.name = "NaverPlaceFetchError";
    this.status = status;
  }
}

/**
 * 페이지 fetch + Apollo state 파싱.
 */
export async function fetchNaverPlace(placeId: string): Promise<NaverPlaceData> {
  const url = `https://m.place.naver.com/restaurant/${encodeURIComponent(placeId)}/home`;
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ko-KR,ko;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new NaverPlaceFetchError(`fetch ${url} failed`, res.status);
  }
  const html = await res.text();

  const apollo = extractApolloState(html);
  if (!apollo) throw new NaverPlaceFetchError("__APOLLO_STATE__ not found");

  return parseApolloState(placeId, apollo);
}

/**
 * `window.__APOLLO_STATE__ = {...};` 추출.
 * 끝의 `;` 또는 다른 변수가 시작될 때까지 매칭.
 */
function extractApolloState(html: string): Record<string, unknown> | null {
  const marker = "window.__APOLLO_STATE__";
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  // = 다음 { 시작
  const eq = html.indexOf("=", idx);
  if (eq < 0) return null;
  const braceStart = html.indexOf("{", eq);
  if (braceStart < 0) return null;

  // 균형 잡힌 중괄호 끝 찾기 (문자열 인지)
  let depth = 0;
  let i = braceStart;
  let inStr = false;
  let strCh = "";
  let escape = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === strCh) {
        inStr = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      strCh = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const jsonText = html.slice(braceStart, i);
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch (e) {
    throw new NaverPlaceFetchError(
      `Apollo state JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function getRef(
  state: Record<string, unknown>,
  ref: { __ref?: string } | string | null | undefined,
): Record<string, unknown> | null {
  if (!ref) return null;
  const key = typeof ref === "string" ? ref : ref.__ref;
  if (!key) return null;
  const v = state[key];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Apollo cache JSON에서 의미 있는 필드 추출.
 * cache key 패턴:
 *   - `PlaceDetailBase:{placeId}` — 매장 기본
 *   - `PlaceDetailHomeRestaurant:{placeId}` 또는 비슷한 변형
 *   - `Menu:{placeId}_{idx}` — 메뉴
 *   - `VisitorReviewStatsResult:{placeId}` — 리뷰 통계
 *   - `SubwayStationInfo:{id}` — 지하철 정보
 */
function parseApolloState(
  placeId: string,
  state: Record<string, unknown>,
): NaverPlaceData {
  // 매장 기본 정보 — `PlaceDetailBase:{placeId}`
  const base = (state[`PlaceDetailBase:${placeId}`] ?? null) as
    | Record<string, unknown>
    | null;

  // 매장 home — visitorReviewsTotal 등이 들어있는 wrapper
  // 키 이름이 동적이므로 placeId 포함 키 중 PlaceDetail* 찾기
  let homeEntity: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(state)) {
    if (
      k.startsWith("PlaceDetail") &&
      k.includes(placeId) &&
      v &&
      typeof v === "object" &&
      "visitorReviewsTotal" in (v as object)
    ) {
      homeEntity = v as Record<string, unknown>;
      break;
    }
  }
  // fallback: 어디든 visitorReviewsTotal 들고 있는 첫 entity
  if (!homeEntity) {
    for (const v of Object.values(state)) {
      if (v && typeof v === "object" && "visitorReviewsTotal" in (v as object)) {
        homeEntity = v as Record<string, unknown>;
        break;
      }
    }
  }

  const name = String(base?.name ?? homeEntity?.name ?? "");
  const category = (base?.category as string | null) ?? (homeEntity?.category as string | null) ?? null;
  const address = (base?.address as string | null) ?? null;
  const roadAddress = (base?.roadAddress as string | null) ?? null;
  const phone = (base?.phone as string | null) ?? null;
  // shopWindow description
  const description =
    (homeEntity?.["description({\"source\":[\"shopWindow\"]})"] as string | null) ??
    (homeEntity?.description as string | null) ??
    null;

  // 키워드 (자동 추출)
  const keywords: string[] = Array.isArray(homeEntity?.keywordList)
    ? (homeEntity!.keywordList as string[])
    : [];

  // hours — 그냥 raw 저장 (구조 복잡, 추후 정규화)
  const hours = (homeEntity?.businessHours ?? base?.businessHours) ?? null;

  // 리뷰 통계
  const visitorReviewsTotal = num(homeEntity?.visitorReviewsTotal);
  const visitorReviewsScore = num(homeEntity?.visitorReviewsScore);
  const visitorReviewsTextTotal = num(homeEntity?.visitorReviewsTextReviewTotal);
  const visitorReviewsMediaTotal = num(homeEntity?.visitorReviewMediasTotal);
  // 블로그 리뷰 수
  const blogReviewsTotal = num(
    (homeEntity?.blogReviewsTotal as number | undefined) ??
      (base?.blogReviewsTotal as number | undefined),
  );

  // 영업 상태
  const businessStatus =
    typeof homeEntity?.businessStatus === "object" && homeEntity.businessStatus
      ? ((homeEntity.businessStatus as { status?: string }).status ?? null)
      : (homeEntity?.businessStatus as string | null) ?? null;

  // 메뉴 — `Menu:{placeId}_{n}`
  const menu: NaverMenuItem[] = [];
  for (const [k, v] of Object.entries(state)) {
    if (k.startsWith(`Menu:${placeId}_`) && v && typeof v === "object") {
      const m = v as Record<string, unknown>;
      const id = k.replace("Menu:", "");
      const name = String(m.name ?? "").trim();
      if (!name) continue;
      const priceRaw = m.price;
      const price =
        typeof priceRaw === "number"
          ? priceRaw
          : typeof priceRaw === "string"
            ? parseInt(priceRaw.replace(/[^\d-]/g, ""), 10) || null
            : null;
      menu.push({
        id,
        name,
        price,
        description: (m.description as string | null) ?? null,
        recommended: !!m.recommend,
        imageUrl: (m.images as { url?: string }[] | undefined)?.[0]?.url ?? null,
      });
    }
  }
  // priority 순으로 정렬 시도 — 없으면 메뉴 이름 순
  menu.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  // 지하철역
  const subwayStations: NaverPlaceData["subwayStations"] = [];
  for (const v of Object.values(state)) {
    if (
      v &&
      typeof v === "object" &&
      "__typename" in v &&
      (v as { __typename?: string }).__typename === "SubwayStationInfo"
    ) {
      const s = v as Record<string, unknown>;
      subwayStations.push({
        name: String(s.displayName ?? s.name ?? ""),
        line: String(s.typeDesc ?? ""),
      });
    }
  }

  // 대표 이미지 (PlaceDetailImages 안의 images)
  const imageUrls: string[] = [];
  for (const v of Object.values(state)) {
    if (
      v &&
      typeof v === "object" &&
      (v as { __typename?: string }).__typename === "PlaceDetailImages"
    ) {
      const imgs = (v as { images?: { origin?: string; src?: string }[] }).images ?? [];
      for (const img of imgs) {
        const u = img.origin ?? img.src;
        if (u && !imageUrls.includes(u)) imageUrls.push(u);
        if (imageUrls.length >= 10) break;
      }
      if (imageUrls.length >= 10) break;
    }
  }

  return {
    placeId,
    name,
    category,
    description,
    address,
    roadAddress,
    phone,
    keywords,
    hours,
    visitorReviewsTotal,
    visitorReviewsScore,
    visitorReviewsTextTotal,
    visitorReviewsMediaTotal,
    blogReviewsTotal,
    businessStatus,
    menu,
    subwayStations,
    imageUrls,
    rawApolloState: state,
    fetchedAt: new Date().toISOString(),
  };
}
