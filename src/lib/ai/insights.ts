/**
 * AI 기반 매출 분석 + 운영 전략 추천.
 *
 * 흐름:
 *   1) DB에서 다양한 분석 데이터 수집 (KPI, 시계열, 히트맵, 상품, 결제수단)
 *   2) Claude API에 한 번에 전달 → 구조화된 추천 받기
 *   3) 결과를 UI에 표시
 *
 * Fallback: ANTHROPIC_API_KEY 미설정 시 rule-based 요약만 반환 (API 비용 절약 + degraded mode).
 */
import { getServerEnv } from "@/lib/config";
import {
  getDailySeries,
  getHourlyHeatmap,
  getKpiSummary,
  getPaymentMethodMix,
  getTopProducts,
  getWeeklySeries,
} from "@/lib/analytics/queries";

export interface Recommendation {
  /** "increase" | "decrease" | "investigate" | "celebrate" */
  kind: "increase" | "decrease" | "investigate" | "celebrate";
  /** 한 줄 제목 */
  title: string;
  /** 2-3문장 설명 — 근거 + 액션 */
  detail: string;
  /** "고" | "중" | "저" */
  priority: "고" | "중" | "저";
}

export interface InsightsResult {
  summary: string;
  recommendations: Recommendation[];
  /** 어떤 소스에서 생성됐는지 */
  source: "claude" | "rules";
  /** 분석에 사용된 데이터 윈도우 */
  windowDays: number;
}

/* ============================================================
 * Public entry
 * ========================================================== */
export async function generateInsights(windowDays = 30): Promise<InsightsResult> {
  // 1) 데이터 수집 (병렬)
  const [kpi, daily, weekly, heatmap, products, paymentMix] = await Promise.all([
    getKpiSummary(),
    getDailySeries(windowDays),
    getWeeklySeries(12),
    getHourlyHeatmap(windowDays),
    getTopProducts(windowDays, 10),
    getPaymentMethodMix(windowDays),
  ]);

  const context = {
    kpi,
    daily,
    weekly,
    heatmap,
    products,
    paymentMix,
    windowDays,
  };

  const env = getServerEnv();
  if (env.ANTHROPIC_API_KEY) {
    try {
      const out = await callClaude(context, env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
      return { ...out, source: "claude", windowDays };
    } catch (e) {
      console.warn("[insights] Claude 호출 실패, rule-based로 fallback:", e);
    }
  }
  return { ...ruleBasedInsights(context), source: "rules", windowDays };
}

/* ============================================================
 * Claude
 * ========================================================== */
async function callClaude(
  context: AnalysisContext,
  apiKey: string,
  model = "claude-sonnet-4-5",
): Promise<{ summary: string; recommendations: Recommendation[] }> {
  const system = `당신은 한국 자영업 매장(베이커리 카페)의 매출 분석 컨설턴트입니다.
주어진 데이터를 분석하여 다음을 한국어로 작성하세요:
1) summary: 매장의 현재 상태를 2-3문장으로 요약 (구체적인 숫자 포함)
2) recommendations: 5-7개의 실행 가능한 개선 제안

각 recommendation은:
- kind: "increase" (확장/증대), "decrease" (축소/제거), "investigate" (조사 필요), "celebrate" (잘 하고 있음)
- title: 15자 이내 한 줄 제목
- detail: 2-3문장. 데이터 근거(어떤 숫자에서 왔는지) + 구체적 액션
- priority: "고" | "중" | "저"

JSON으로만 응답하세요. 다른 텍스트 없이.`;

  const userPrompt = buildUserPrompt(context);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude 응답에 text 블록이 없습니다");

  // JSON 추출 — Claude가 ```json...``` 으로 감쌀 수 있음
  const json = extractJson(textBlock.text);
  const parsed = JSON.parse(json) as {
    summary: string;
    recommendations: Recommendation[];
  };
  return parsed;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*\n([\s\S]+?)\n```/);
  if (fence) return fence[1] ?? text;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}

function buildUserPrompt(c: AnalysisContext): string {
  return `매장: 니드 베이커스 (서울 동작구 상도동, 베이커리 카페)
분석 윈도우: 지난 ${c.windowDays}일

### KPI
- 오늘 매출: ${c.kpi.today.revenue.toLocaleString()}원, 주문 ${c.kpi.today.orderCount}건, 객단가 ${c.kpi.today.avgTicket.toLocaleString()}원
- 어제: ${c.kpi.yesterday.revenue.toLocaleString()}원, ${c.kpi.yesterday.orderCount}건
- 이번주: ${c.kpi.thisWeek.revenue.toLocaleString()}원 (지난주 ${c.kpi.lastWeek.revenue.toLocaleString()}원)
- 이번달: ${c.kpi.thisMonth.revenue.toLocaleString()}원 (지난달 ${c.kpi.lastMonth.revenue.toLocaleString()}원)
- 이번달 객단가: ${c.kpi.thisMonth.avgTicket.toLocaleString()}원 / 주문 ${c.kpi.thisMonth.orderCount}건 / 취소 ${c.kpi.thisMonth.cancelledCount}건

### 주별 추이 (최근 12주, 매출 원)
${c.weekly.map((w) => `${w.weekStart}: ${w.revenue.toLocaleString()}원 (${w.orderCount}건)`).join("\n")}

### 시간대 히트맵 (요일 0=일~6=토 × 시간, 최근 ${c.windowDays}일)
${c.heatmap
  .filter((h) => h.orderCount > 0)
  .map(
    (h) =>
      `dow=${h.dow} hour=${h.hour}: ${h.revenue.toLocaleString()}원, ${h.orderCount}건, 객단가 ${h.avgTicket.toLocaleString()}원`,
  )
  .join("\n")}

### 인기 상품 TOP 10 (수량/매출, ${c.windowDays}일)
${c.products.map((p, i) => `${i + 1}. ${p.itemTitle} (${p.categoryTitle ?? "-"}): ${p.quantity}개, ${p.revenue.toLocaleString()}원`).join("\n")}

### 결제수단 비중 (${c.windowDays}일)
${c.paymentMix.map((m) => `${m.method}: ${m.revenue.toLocaleString()}원 (${(m.share * 100).toFixed(1)}%)`).join("\n")}

위 데이터를 바탕으로 사장님이 바로 실행할 수 있는 매출/운영 개선안을 시스템 프롬프트의 JSON 포맷으로 답해주세요.`;
}

interface AnalysisContext {
  kpi: Awaited<ReturnType<typeof getKpiSummary>>;
  daily: Awaited<ReturnType<typeof getDailySeries>>;
  weekly: Awaited<ReturnType<typeof getWeeklySeries>>;
  heatmap: Awaited<ReturnType<typeof getHourlyHeatmap>>;
  products: Awaited<ReturnType<typeof getTopProducts>>;
  paymentMix: Awaited<ReturnType<typeof getPaymentMethodMix>>;
  windowDays: number;
}

/* ============================================================
 * Rule-based fallback — Claude 없을 때 또는 실패 시
 * ========================================================== */
function ruleBasedInsights(c: AnalysisContext): {
  summary: string;
  recommendations: Recommendation[];
} {
  const recs: Recommendation[] = [];

  // 1) 월 매출 비교
  const moM = c.kpi.lastMonth.revenue > 0
    ? (c.kpi.thisMonth.revenue - c.kpi.lastMonth.revenue) / c.kpi.lastMonth.revenue
    : 0;
  if (moM < -0.1) {
    recs.push({
      kind: "investigate",
      title: "이번달 매출 감소",
      detail: `이번달 매출이 지난달 대비 ${(moM * 100).toFixed(1)}% 감소했습니다 (${c.kpi.thisMonth.revenue.toLocaleString()}원 vs ${c.kpi.lastMonth.revenue.toLocaleString()}원). 일별 추이와 시간대를 확인해 원인을 파악하세요.`,
      priority: "고",
    });
  } else if (moM > 0.1) {
    recs.push({
      kind: "celebrate",
      title: "이번달 매출 성장",
      detail: `이번달 매출이 지난달 대비 ${(moM * 100).toFixed(1)}% 증가했습니다. 어떤 변화(메뉴/시간/마케팅)가 효과적이었는지 기록해 두세요.`,
      priority: "중",
    });
  }

  // 2) 시간대 비어있는 슬롯 (영업시간 내 주문 < 1건/일 평균)
  const dayCount = Math.max(c.windowDays, 1);
  const emptyByHour: Record<number, number> = {};
  for (const cell of c.heatmap) {
    if (cell.hour >= 7 && cell.hour <= 22) {
      emptyByHour[cell.hour] = (emptyByHour[cell.hour] ?? 0) + cell.orderCount;
    }
  }
  const weakHours = Object.entries(emptyByHour)
    .filter(([, count]) => count < dayCount * 0.3)
    .map(([h]) => Number(h));
  if (weakHours.length > 0) {
    recs.push({
      kind: "investigate",
      title: "약한 시간대 발견",
      detail: `${weakHours.join("시, ")}시 시간대 주문이 평균 일 1건 미만으로 매우 적습니다. 해당 시간대 한정 프로모션이나 영업시간 조정을 검토하세요.`,
      priority: "중",
    });
  }

  // 3) Top 상품 집중도
  if (c.products.length >= 3) {
    const top3Rev = c.products.slice(0, 3).reduce((s, p) => s + p.revenue, 0);
    const totalTopRev = c.products.reduce((s, p) => s + p.revenue, 0);
    const share = totalTopRev > 0 ? top3Rev / totalTopRev : 0;
    if (share > 0.6) {
      recs.push({
        kind: "investigate",
        title: "TOP3 상품 의존도 높음",
        detail: `상위 3개 상품(${c.products
          .slice(0, 3)
          .map((p) => p.itemTitle)
          .join(", ")})이 매출 ${(share * 100).toFixed(0)}%를 차지합니다. 1-2개 차순위 상품 강화로 리스크를 분산하세요.`,
        priority: "저",
      });
    }
  }

  // 4) 결제수단 — 현금 비중
  const cash = c.paymentMix.find((m) => m.method === "현금");
  if (cash && cash.share > 0.2) {
    recs.push({
      kind: "investigate",
      title: "현금 비중 높음",
      detail: `현금 결제 비중이 ${(cash.share * 100).toFixed(1)}%로 평균적인 카페보다 높은 편입니다. 현금영수증 발행 누락 여부와 회계 처리를 점검하세요.`,
      priority: "저",
    });
  }

  // 5) 객단가 변화
  const ticketMoM = c.kpi.lastMonth.avgTicket > 0
    ? (c.kpi.thisMonth.avgTicket - c.kpi.lastMonth.avgTicket) / c.kpi.lastMonth.avgTicket
    : 0;
  if (Math.abs(ticketMoM) > 0.05) {
    recs.push({
      kind: ticketMoM > 0 ? "celebrate" : "investigate",
      title: ticketMoM > 0 ? "객단가 상승" : "객단가 하락",
      detail: `이번달 객단가가 지난달 대비 ${(ticketMoM * 100).toFixed(1)}% ${ticketMoM > 0 ? "상승" : "하락"}했습니다 (${c.kpi.thisMonth.avgTicket.toLocaleString()}원 vs ${c.kpi.lastMonth.avgTicket.toLocaleString()}원). 세트 메뉴/사이드 추가 판매 등을 통해 객단가를 관리하세요.`,
      priority: ticketMoM > 0 ? "저" : "중",
    });
  }

  return {
    summary: `최근 ${c.windowDays}일간 ${c.products.length}개 상품에서 매출이 발생했고, 이번달 매출은 ${c.kpi.thisMonth.revenue.toLocaleString()}원입니다 (지난달 대비 ${moM >= 0 ? "+" : ""}${(moM * 100).toFixed(1)}%). 객단가는 ${c.kpi.thisMonth.avgTicket.toLocaleString()}원, 주문 ${c.kpi.thisMonth.orderCount}건입니다.`,
    recommendations: recs.length
      ? recs
      : [
          {
            kind: "investigate",
            title: "데이터 더 모이면 추천 활성화",
            detail: "현재 데이터가 적어 의미 있는 패턴을 찾기 어렵습니다. 1-2주 더 운영 후 다시 확인해 주세요.",
            priority: "저",
          },
        ],
  };
}
