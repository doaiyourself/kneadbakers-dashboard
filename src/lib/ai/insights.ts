/**
 * 룰 기반 + (선택적) LLM 매출 인사이트.
 *
 * 흐름:
 *   1) DB에서 다양한 분석 데이터 수집 (KPI, 시계열, 히트맵, 상품, 결제수단, 카니발리제이션, 시간대 객단가)
 *   2) 룰 기반 엔진으로 패턴 탐지 → 자연어 추천 생성
 *   3) ANTHROPIC_API_KEY 있으면 Claude로 한 번 더 풍부하게 (선택)
 *
 * 사용자 환경: ANTHROPIC_API_KEY 없어도 충분히 의미 있는 추천 동작.
 */
import { getServerEnv } from "@/lib/config";
import {
  getCategoryRollup,
  getChannelMix,
  getDailySeries,
  getDaypartSeries,
  getDowSeries,
  getHourlyHeatmap,
  getKpiSummary,
  getPaymentMethodMix,
  getProductPairs,
  getTopProducts,
  getWeeklySeries,
  type DateRange,
} from "@/lib/analytics/queries";

export interface Recommendation {
  /** "increase" | "decrease" | "investigate" | "celebrate" */
  kind: "increase" | "decrease" | "investigate" | "celebrate";
  title: string;
  detail: string;
  priority: "고" | "중" | "저";
}

export interface InsightsResult {
  summary: string;
  recommendations: Recommendation[];
  source: "claude" | "rules";
  windowDays: number;
}

const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/* ============================================================
 * Public entry
 * ========================================================== */
export async function generateInsights(
  range: DateRange = { fallbackDays: 30 },
): Promise<InsightsResult> {
  const windowDays = range.fallbackDays ?? 30;
  // 데이터 수집 (병렬)
  const [
    kpi,
    daily,
    weekly,
    heatmap,
    dow,
    products,
    paymentMix,
    channels,
    categories,
    pairs,
    daypart,
  ] = await Promise.all([
    getKpiSummary(),
    getDailySeries({ ...range, days: windowDays }),
    getWeeklySeries({ ...range, weeks: 12 }),
    getHourlyHeatmap({ ...range, days: windowDays }),
    getDowSeries(range),
    getTopProducts({ ...range, limit: 20 }),
    getPaymentMethodMix(range),
    getChannelMix(range),
    getCategoryRollup(range),
    getProductPairs({ ...range, limit: 20 }),
    getDaypartSeries(range),
  ]);

  const context = {
    kpi,
    daily,
    weekly,
    heatmap,
    dow,
    products,
    paymentMix,
    channels,
    categories,
    pairs,
    daypart,
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

interface AnalysisContext {
  kpi: Awaited<ReturnType<typeof getKpiSummary>>;
  daily: Awaited<ReturnType<typeof getDailySeries>>;
  weekly: Awaited<ReturnType<typeof getWeeklySeries>>;
  heatmap: Awaited<ReturnType<typeof getHourlyHeatmap>>;
  dow: Awaited<ReturnType<typeof getDowSeries>>;
  products: Awaited<ReturnType<typeof getTopProducts>>;
  paymentMix: Awaited<ReturnType<typeof getPaymentMethodMix>>;
  channels: Awaited<ReturnType<typeof getChannelMix>>;
  categories: Awaited<ReturnType<typeof getCategoryRollup>>;
  pairs: Awaited<ReturnType<typeof getProductPairs>>;
  daypart: Awaited<ReturnType<typeof getDaypartSeries>>;
  windowDays: number;
}

/* ============================================================
 * Rule-based engine — 데이터 패턴 자동 탐지
 * ========================================================== */
function ruleBasedInsights(c: AnalysisContext): {
  summary: string;
  recommendations: Recommendation[];
} {
  const recs: Recommendation[] = [];

  // ===== 1) MoM 매출 변화 (threshold 5%) =====
  const moM =
    c.kpi.lastMonth.revenue > 0
      ? (c.kpi.thisMonth.revenue - c.kpi.lastMonth.revenue) / c.kpi.lastMonth.revenue
      : 0;
  if (moM < -0.05) {
    recs.push({
      kind: "investigate",
      title: "이번달 매출 감소",
      detail: `이번달 매출이 지난달 대비 ${pct(moM)}% 감소했습니다 (${krw(c.kpi.thisMonth.revenue)} vs ${krw(c.kpi.lastMonth.revenue)}). 약한 요일·시간대·메뉴 변화를 점검해 보세요.`,
      priority: Math.abs(moM) > 0.15 ? "고" : "중",
    });
  } else if (moM > 0.05) {
    recs.push({
      kind: "celebrate",
      title: "이번달 매출 성장",
      detail: `이번달 매출이 지난달 대비 +${pct(moM)}% 증가 (${krw(c.kpi.thisMonth.revenue)}). 효과적이었던 요인 (메뉴/마케팅/날씨)을 기록해 두면 시즌별 패턴 분석에 도움됩니다.`,
      priority: "중",
    });
  }

  // ===== 1-b) 최근 7일 vs 그 이전 7일 (단기 추세) =====
  if (c.daily.length >= 14) {
    const last7 = c.daily.slice(-7).reduce((s, d) => s + d.revenue, 0);
    const prev7 = c.daily.slice(-14, -7).reduce((s, d) => s + d.revenue, 0);
    if (prev7 > 0) {
      const wow = (last7 - prev7) / prev7;
      if (Math.abs(wow) > 0.1) {
        recs.push({
          kind: wow > 0 ? "celebrate" : "investigate",
          title: wow > 0 ? "최근 일주일 성장" : "최근 일주일 둔화",
          detail: `직전 7일이 그 전 7일 대비 ${wow > 0 ? "+" : "-"}${pct(wow)}% 변동 (${krw(last7)} vs ${krw(prev7)}). 단기 트렌드 추적용 신호입니다.`,
          priority: Math.abs(wow) > 0.2 ? "중" : "저",
        });
      }
    }
  }

  // ===== 1-c) 평일 vs 주말 =====
  if (c.dow.length >= 6) {
    const weekday = c.dow.filter((d) => d.dow >= 1 && d.dow <= 5);
    const weekend = c.dow.filter((d) => d.dow === 0 || d.dow === 6);
    if (weekday.length > 0 && weekend.length > 0) {
      const wdAvg = weekday.reduce((s, d) => s + d.revenue, 0) / weekday.length;
      const weAvg = weekend.reduce((s, d) => s + d.revenue, 0) / weekend.length;
      if (wdAvg > 0 && weAvg > 0) {
        const ratio = weAvg / wdAvg;
        if (ratio > 1.2) {
          recs.push({
            kind: "increase",
            title: "주말 매출 강세",
            detail: `주말 평균 매출이 평일 대비 +${pct((weAvg - wdAvg) / wdAvg)}% 높습니다 (${krw(weAvg)} vs ${krw(wdAvg)}). 주말 인력·재고 강화 검토.`,
            priority: "중",
          });
        } else if (ratio < 0.83) {
          recs.push({
            kind: "investigate",
            title: "주말 매출 약함",
            detail: `주말 평균 매출이 평일 대비 ${pct((wdAvg - weAvg) / wdAvg)}% 낮습니다 (${krw(weAvg)} vs ${krw(wdAvg)}). 주말 한정 메뉴/이벤트 검토.`,
            priority: "중",
          });
        }
      }
    }
  }

  // ===== 2) 요일별 편차 =====
  if (c.dow.length >= 5) {
    const dowAvg = c.dow.reduce((s, d) => s + d.revenue, 0) / c.dow.length;
    const worst = c.dow.reduce((min, d) => (d.revenue < min.revenue ? d : min));
    const best = c.dow.reduce((max, d) => (d.revenue > max.revenue ? d : max));
    if (dowAvg > 0 && worst.revenue / dowAvg < 0.7) {
      const deficit = (worst.revenue - dowAvg) / dowAvg;
      recs.push({
        kind: "investigate",
        title: `${DOW_LABEL[worst.dow]}요일 매출 약함`,
        detail: `${DOW_LABEL[worst.dow]}요일 평균 매출이 전체 평균 대비 ${pct(deficit)}% 낮습니다 (${krw(worst.revenue)} vs 평균 ${krw(dowAvg)}). 그날 한정 프로모션이나 신메뉴 출시 검토.`,
        priority: "중",
      });
    }
    if (dowAvg > 0 && best.revenue / dowAvg > 1.3) {
      const surplus = (best.revenue - dowAvg) / dowAvg;
      recs.push({
        kind: "celebrate",
        title: `${DOW_LABEL[best.dow]}요일 강세`,
        detail: `${DOW_LABEL[best.dow]}요일이 전체 평균 대비 ${pct(surplus)}% 높습니다 (${krw(best.revenue)}). 이날 트래픽을 객단가로 전환하는 추가 상품 진열 권장.`,
        priority: "저",
      });
    }
  }

  // ===== 3) 시간대 — 비어있는 시간 =====
  const days = Math.max(c.windowDays, 1);
  const byHour: Record<number, number> = {};
  for (const cell of c.heatmap) {
    if (cell.hour >= 7 && cell.hour <= 22) {
      byHour[cell.hour] = (byHour[cell.hour] ?? 0) + cell.orderCount;
    }
  }
  const weakHours = Object.entries(byHour)
    .filter(([, count]) => count < days * 0.5)
    .map(([h]) => Number(h))
    .sort((a, b) => a - b);
  if (weakHours.length > 0 && weakHours.length < 8) {
    recs.push({
      kind: "investigate",
      title: "약한 시간대 발견",
      detail: `${weakHours.map((h) => `${h}시`).join(", ")} 시간대 평균 주문이 일 0.5건 미만입니다. 영업시간 조정 또는 그 시간대 한정 프로모션 검토.`,
      priority: "중",
    });
  }

  // ===== 4) 시간대 객단가 비교 =====
  if (c.daypart.length >= 3) {
    const am = c.daypart.find((d) => d.daypart.startsWith("오전"));
    const pm = c.daypart.find((d) => d.daypart.startsWith("오후"));
    if (am && pm && am.avgTicket > 0 && pm.avgTicket > 0) {
      const ratio = pm.avgTicket / am.avgTicket;
      if (ratio > 1.3) {
        recs.push({
          kind: "increase",
          title: "오전 객단가 낮음",
          detail: `오전 객단가(${krw(am.avgTicket)}) 가 오후(${krw(pm.avgTicket)}) 대비 ${pct((am.avgTicket - pm.avgTicket) / pm.avgTicket)}% 낮습니다. 오전 세트(커피+베이커리) 메뉴 도입 또는 베이커리 추천 진열로 객단가 ↑.`,
          priority: "중",
        });
      } else if (ratio < 0.77) {
        recs.push({
          kind: "investigate",
          title: "오후 객단가 낮음",
          detail: `오후 객단가(${krw(pm.avgTicket)}) 가 오전(${krw(am.avgTicket)}) 보다 낮습니다. 오후 시간대 단품 위주 — 디저트/세트 어필 검토.`,
          priority: "저",
        });
      }
    }
  }

  // ===== 5) 카테고리 집중도 (threshold 45%) =====
  if (c.categories.length >= 2) {
    const top = c.categories[0]!;
    if (top.share > 0.45) {
      recs.push({
        kind: "investigate",
        title: `${top.category} 카테고리 비중 ${pct(top.share)}%`,
        detail: `${top.category}가 매출의 ${pct(top.share)}%를 차지합니다. 차순위 카테고리(${c.categories[1]?.category ?? "-"}, ${pct(c.categories[1]?.share ?? 0)}%) 강화로 리스크 분산 검토.`,
        priority: top.share > 0.6 ? "중" : "저",
      });
    }
  }

  // ===== 6) TOP3 상품 집중도 (threshold 35%) =====
  if (c.products.length >= 3) {
    const totalRev = c.products.reduce((s, p) => s + p.revenue, 0);
    const top3Rev = c.products.slice(0, 3).reduce((s, p) => s + p.revenue, 0);
    const share = totalRev > 0 ? top3Rev / totalRev : 0;
    if (share > 0.35) {
      recs.push({
        kind: "investigate",
        title: "TOP3 상품 집중도 높음",
        detail: `상위 3개 상품(${c.products
          .slice(0, 3)
          .map((p) => p.itemTitle)
          .join(", ")})이 매출 ${pct(share)}%를 차지합니다. 4~10위 상품 디스플레이·번들로 분산 검토.`,
        priority: share > 0.55 ? "중" : "저",
      });
    }
  }

  // ===== 6-b) 단일 상품 의존도 (>15%면 알림) =====
  if (c.products.length > 0) {
    const totalRev = c.products.reduce((s, p) => s + p.revenue, 0);
    const top = c.products[0]!;
    const share = totalRev > 0 ? top.revenue / totalRev : 0;
    if (share > 0.15) {
      recs.push({
        kind: "celebrate",
        title: `${top.itemTitle} 1위`,
        detail: `「${top.itemTitle}」이 매출 ${pct(share)}%, ${top.quantity}개 판매로 압도적 1위 (${krw(top.revenue)}). 진열·재고·품질 관리 최우선.`,
        priority: "저",
      });
    }
  }

  // ===== 6-c) 부진 상품 — 마지막 10% 매출 차지하는 꼬리 =====
  if (c.products.length >= 10) {
    const totalRev = c.products.reduce((s, p) => s + p.revenue, 0);
    const sorted = [...c.products].sort((a, b) => a.revenue - b.revenue);
    let cum = 0;
    const tail: typeof c.products = [];
    for (const p of sorted) {
      if (cum >= totalRev * 0.05) break;
      tail.push(p);
      cum += p.revenue;
    }
    if (tail.length >= 5) {
      recs.push({
        kind: "decrease",
        title: "부진 상품 정리 검토",
        detail: `하위 ${tail.length}개 상품이 매출 5% 미만 (예: ${tail.slice(0, 3).map((p) => p.itemTitle).join(", ")} 등). 단종·할인·재구성 검토로 메뉴판 슬림화.`,
        priority: "저",
      });
    }
  }

  // ===== 7) 채널 분석 — 배달앱 의존도 =====
  if (c.channels.length > 0) {
    const delivery = c.channels.filter(
      (c) =>
        c.source.includes("BAEMIN") ||
        c.source.includes("YOGIYO") ||
        c.source.includes("COUPANG") ||
        c.source.includes("DELIVERY"),
    );
    const deliveryShare = delivery.reduce((s, c) => s + c.share, 0);
    if (deliveryShare > 0.3) {
      recs.push({
        kind: "investigate",
        title: "배달앱 의존도 높음",
        detail: `배달앱 매출 비중 ${pct(deliveryShare)}%. 배달앱 수수료(10-15%)로 실수익률이 낮아질 수 있어요. 자체 채널(POS/키오스크) 트래픽 강화 또는 배달 전용 메뉴 가격 재검토.`,
        priority: "중",
      });
    }
  }

  // ===== 8) 카니발리제이션 (동시구매 패턴) — TOP 3 =====
  if (c.pairs.length > 0) {
    const topPairs = c.pairs.slice(0, 3);
    recs.push({
      kind: "increase",
      title: "추천 세트 조합",
      detail: `자주 묶이는 상품 조합: ${topPairs
        .map((p) => `「${p.productA}」+「${p.productB}」 ${p.coOrders}회`)
        .join(", ")}. 세트 메뉴 또는 사이드 추천 도입으로 객단가·전환 향상 가능.`,
      priority: "중",
    });
  }

  // ===== 9) 이상치 일자 — 상승 1개 + 하락 1개 =====
  if (c.daily.length >= 7) {
    const anomalies: { date: string; delta: number; revenue: number }[] = [];
    for (let i = 1; i < c.daily.length; i++) {
      const prev = c.daily[i - 1]!;
      const cur = c.daily[i]!;
      if (prev.revenue > 0) {
        const delta = (cur.revenue - prev.revenue) / prev.revenue;
        if (Math.abs(delta) > 0.4 && cur.revenue > 100000) {
          anomalies.push({ date: cur.date, delta, revenue: cur.revenue });
        }
      }
    }
    if (anomalies.length > 0) {
      const ups = anomalies.filter((a) => a.delta > 0).sort((a, b) => b.delta - a.delta);
      const downs = anomalies.filter((a) => a.delta < 0).sort((a, b) => a.delta - b.delta);
      if (ups[0]) {
        recs.push({
          kind: "celebrate",
          title: `${ups[0].date} 매출 급등`,
          detail: `${ups[0].date}에 전일 대비 +${pct(ups[0].delta)}% 점프 (${krw(ups[0].revenue)}). 어떤 요인(이벤트/날씨/SNS)이 작용했는지 기록해 재현 가능한지 확인.`,
          priority: "저",
        });
      }
      if (downs[0]) {
        recs.push({
          kind: "investigate",
          title: `${downs[0].date} 매출 급감`,
          detail: `${downs[0].date}에 전일 대비 -${pct(downs[0].delta)}% 하락 (${krw(downs[0].revenue)}). 휴무·날씨·운영 이슈 등 원인 파악.`,
          priority: "저",
        });
      }
    }
  }

  // ===== 10) 결제수단 분포 =====
  const cash = c.paymentMix.find((m) => m.method === "현금");
  if (cash && cash.share > 0.1) {
    recs.push({
      kind: "investigate",
      title: "현금 비중 높음",
      detail: `현금 결제 비중 ${pct(cash.share)}%. 현금영수증 발행 누락 여부와 회계 처리 점검.`,
      priority: cash.share > 0.2 ? "중" : "저",
    });
  }
  // 카드 외 간편결제 비중도 체크
  const easyPay = c.paymentMix.find((m) => m.method === "선불지급수단");
  if (easyPay && easyPay.share > 0.1) {
    recs.push({
      kind: "celebrate",
      title: "간편결제 활성화",
      detail: `간편결제(카카오페이/네이버페이 등) 비중 ${pct(easyPay.share)}%. 모바일 친화 고객 비중이 높아 SNS·앱 마케팅 효과 클 수 있음.`,
      priority: "저",
    });
  }

  // ===== 10-b) 1위 채널 의존도 =====
  if (c.channels.length > 0) {
    const top = c.channels[0]!;
    if (top.share > 0.5) {
      const label =
        top.source === "POS"
          ? "POS"
          : top.source === "KIOSK"
            ? "키오스크"
            : top.source.includes("BAEMIN")
              ? "배달의민족"
              : top.source;
      recs.push({
        kind: "investigate",
        title: `${label} 채널 의존도 ${pct(top.share)}%`,
        detail: `${label} 채널이 매출 ${pct(top.share)}%를 차지합니다. 단일 채널 의존은 정책·수수료·시스템 변화에 취약 — 차순위 채널 강화 검토.`,
        priority: top.share > 0.7 ? "중" : "저",
      });
    }
  }

  // ===== 11) 객단가 변화 =====
  const ticketMoM =
    c.kpi.lastMonth.avgTicket > 0
      ? (c.kpi.thisMonth.avgTicket - c.kpi.lastMonth.avgTicket) / c.kpi.lastMonth.avgTicket
      : 0;
  if (Math.abs(ticketMoM) > 0.05) {
    recs.push({
      kind: ticketMoM > 0 ? "celebrate" : "investigate",
      title: ticketMoM > 0 ? "객단가 상승" : "객단가 하락",
      detail: `이번달 객단가 ${pct(ticketMoM)}% ${ticketMoM > 0 ? "상승" : "하락"} (${krw(c.kpi.thisMonth.avgTicket)} vs ${krw(c.kpi.lastMonth.avgTicket)}). ${ticketMoM > 0 ? "세트/사이드 판매 성공 — 유지 전략." : "단가 하락 원인 점검 (할인 남용, 메뉴 구성 변경 등)."}`,
      priority: ticketMoM > 0 ? "저" : "중",
    });
  }

  // 우선순위 정렬: 고 > 중 > 저
  const priOrder = { 고: 0, 중: 1, 저: 2 };
  recs.sort((a, b) => priOrder[a.priority] - priOrder[b.priority]);

  // 요약
  const totalRevenue = c.kpi.thisMonth.revenue;
  const sign = moM > 0 ? "+" : moM < 0 ? "-" : "";
  const moMText = moM === 0 ? "" : `(전월 대비 ${sign}${pct(moM)}%)`;
  const summary = `이번달 매출 ${krw(totalRevenue)} ${moMText}, 주문 ${c.kpi.thisMonth.orderCount}건, 평균 객단가 ${krw(c.kpi.thisMonth.avgTicket)}. ${c.products.length}개 상품 판매 중이고 최고 매출 상품은 「${c.products[0]?.itemTitle ?? "-"}」입니다. 룰 기반 분석으로 ${recs.length}개 인사이트를 찾았습니다.`;

  return {
    summary,
    recommendations: recs.length
      ? recs
      : [
          {
            kind: "investigate",
            title: "데이터 더 모이면 추천 활성화",
            detail: "패턴 탐지에 충분한 데이터가 아직 부족합니다. 1-2주 더 운영 후 다시 확인해주세요.",
            priority: "저",
          },
        ],
  };
}

function pct(ratio: number): string {
  return `${(Math.abs(ratio) * 100).toFixed(1)}`;
}
function krw(n: number): string {
  return `₩${n.toLocaleString()}`;
}

/* ============================================================
 * Claude (선택) — API 키 있으면 룰 기반 결과를 풍부하게 보완
 * ========================================================== */
async function callClaude(
  c: AnalysisContext,
  apiKey: string,
  model = "claude-sonnet-4-5",
): Promise<{ summary: string; recommendations: Recommendation[] }> {
  const system = `당신은 한국 자영업 매장(베이커리 카페)의 매출 분석 컨설턴트입니다.
주어진 데이터를 분석하여 다음을 한국어로 작성하세요:
1) summary: 매장의 현재 상태를 2-3문장으로 요약 (구체적인 숫자 포함)
2) recommendations: 5-7개의 실행 가능한 개선 제안

각 recommendation은 JSON 객체로:
- kind: "increase" | "decrease" | "investigate" | "celebrate"
- title: 15자 이내
- detail: 2-3문장. 데이터 근거 + 구체적 액션
- priority: "고" | "중" | "저"

JSON으로만 응답. 다른 텍스트 없이.`;

  const userPrompt = buildClaudePrompt(c);
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
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("no text block");
  const json = extractJson(text);
  return JSON.parse(json);
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*\n([\s\S]+?)\n```/);
  if (fence) return fence[1] ?? text;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}

function buildClaudePrompt(c: AnalysisContext): string {
  return `매장: 니드 베이커스 (서울 동작구 상도동, 베이커리 카페)
분석 윈도우: 지난 ${c.windowDays}일

### KPI
- 오늘: ${krw(c.kpi.today.revenue)}, ${c.kpi.today.orderCount}건
- 이번주: ${krw(c.kpi.thisWeek.revenue)} (지난주 ${krw(c.kpi.lastWeek.revenue)})
- 이번달: ${krw(c.kpi.thisMonth.revenue)} (지난달 ${krw(c.kpi.lastMonth.revenue)}), 객단가 ${krw(c.kpi.thisMonth.avgTicket)}

### 요일별 (0=일~6=토)
${c.dow.map((d) => `${DOW_LABEL[d.dow]}: ${krw(d.revenue)} (${d.orderCount}건, 객단가 ${krw(d.avgTicket)})`).join("\n")}

### 시간대 객단가
${c.daypart.map((d) => `${d.daypart}: ${krw(d.revenue)} (${d.orderCount}건, 객단가 ${krw(d.avgTicket)})`).join("\n")}

### 카테고리 매출
${c.categories.map((c) => `${c.category}: ${krw(c.revenue)} (${pct(c.share)}%)`).join("\n")}

### TOP 10 상품
${c.products.slice(0, 10).map((p, i) => `${i + 1}. ${p.itemTitle} (${p.categoryTitle ?? "-"}): ${p.quantity}개, ${krw(p.revenue)}`).join("\n")}

### 자주 묶이는 상품 TOP 5
${c.pairs.slice(0, 5).map((p) => `${p.productA} + ${p.productB}: ${p.coOrders}회`).join("\n")}

### 채널
${c.channels.map((c) => `${c.source}: ${krw(c.revenue)} (${pct(c.share)}%)`).join("\n")}

### 결제수단
${c.paymentMix.map((m) => `${m.method}: ${krw(m.revenue)} (${pct(m.share)}%)`).join("\n")}

위 데이터로 사장님이 바로 실행할 수 있는 매출/운영 개선안을 JSON 포맷으로.`;
}
