/**
 * 토스플레이스 Open API HTTP 클라이언트.
 *
 * - 인증 헤더 자동 부착 (x-access-key, x-secret-key)
 * - 429 (rate limit) / 5xx 자동 재시도 — `x-ratelimit-reset` 또는 지수 백오프
 * - merchantId는 env에서 기본값, 호출 시 override 가능
 * - 응답은 unknown으로 반환 — 호출부에서 타입 캐스팅 또는 zod 검증
 *
 * 보안: TOSS_SECRET_KEY는 서버 전용. 클라이언트 번들에 절대 들어가면 안 됨.
 */
import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE, getServerEnv } from "@/lib/config";
import type {
  TossCatalogItem,
  TossOrder,
  TossOrderListParams,
} from "./types";

/**
 * 토스 응답 봉투. 모든 응답은 이 모양으로 옴:
 *   { resultType: "SUCCESS" | "FAIL", error: ..., success: ... }
 */
export interface TossEnvelope<T> {
  resultType: "SUCCESS" | "FAIL";
  error: { errorCode?: string; reason?: string; data?: unknown } | null;
  success: T | null;
}

export class TossApiError extends Error {
  status: number;
  body: unknown;
  errorCode?: string;
  constructor(status: number, body: unknown, msg?: string) {
    super(msg ?? `Toss API ${status}`);
    this.name = "TossApiError";
    this.status = status;
    this.body = body;
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error?: { errorCode?: string } }).error;
      this.errorCode = err?.errorCode;
    }
  }
}

/**
 * 토스 API가 받아들이는 시간 포맷 (검증됨).
 * - ISO 8601 with timezone offset (e.g., `2026-05-20T00:00:00+09:00`)
 * - ISO UTC Z (e.g., `2026-05-19T15:00:00Z`)
 * - Epoch ms (number string)
 *
 * naive ISO (`2026-05-20T00:00:00`) 와 date-only (`2026-05-20`)는 400 떨어짐.
 *
 * 이 헬퍼는 ISO + Asia/Seoul offset 포맷으로 정규화 (사람이 읽기 좋음).
 */
export function formatTossDateTime(d: Date): string {
  return formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export interface TossClientOptions {
  /** 다중 매장 지원 대비 — 호출별 override */
  merchantId?: number;
  /** 재시도 최대 횟수 (기본 3) */
  maxRetries?: number;
  /** AbortSignal — 외부에서 타임아웃/취소 */
  signal?: AbortSignal;
}

interface RequestParams extends TossClientOptions {
  path: string; // /merchants/{mid} 아래 경로 (예: "/order/orders")
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | string[] | undefined>;
  body?: unknown;
}

function buildQuery(query?: Record<string, string | number | string[] | undefined>): string {
  if (!query) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      // 토스 컨벤션 추정 — 같은 키 반복 (?orderStates=COMPLETED&orderStates=CANCELLED)
      for (const item of v) usp.append(k, String(item));
    } else {
      usp.set(k, String(v));
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** 토스 클라이언트 — 모든 호출은 이걸 통해서. */
export function tossClient() {
  const env = getServerEnv();
  const baseUrl = env.TOSS_BASE_URL.replace(/\/$/, "");
  if (!env.TOSS_ACCESS_KEY || !env.TOSS_SECRET_KEY) {
    throw new Error(
      "[toss] TOSS_ACCESS_KEY / TOSS_SECRET_KEY 가 설정되어 있지 않습니다. .env.local 을 확인하세요.",
    );
  }
  const accessKey: string = env.TOSS_ACCESS_KEY;
  const secretKey: string = env.TOSS_SECRET_KEY;
  const defaultMerchantId = env.TOSS_MERCHANT_ID ? Number(env.TOSS_MERCHANT_ID) : undefined;

  async function request<T = unknown>(p: RequestParams): Promise<T> {
    const merchantId = p.merchantId ?? defaultMerchantId;
    if (!merchantId) {
      throw new Error("[toss] merchantId 가 필요합니다. TOSS_MERCHANT_ID 또는 호출 시 override.");
    }
    const url = `${baseUrl}/merchants/${merchantId}${p.path}${buildQuery(p.query)}`;
    const maxRetries = p.maxRetries ?? 3;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: p.method ?? "GET",
          headers: {
            "x-access-key": accessKey,
            "x-secret-key": secretKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: p.body ? JSON.stringify(p.body) : undefined,
          signal: p.signal,
        });

        // 429 / 5xx — 재시도
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const reset = Number(res.headers.get("x-ratelimit-reset"));
          const retryAfter = Number(res.headers.get("retry-after"));
          const backoff =
            (Number.isFinite(reset) && reset > 0
              ? reset * 1000
              : Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : Math.min(1000 * 2 ** attempt, 8000)) +
            Math.floor(Math.random() * 250);
          console.warn(
            `[toss] ${res.status} ${url} — backing off ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await sleep(backoff, p.signal);
          continue;
        }

        const contentType = res.headers.get("content-type") ?? "";
        const text = await res.text();
        const data = contentType.includes("application/json") && text ? JSON.parse(text) : text;

        if (!res.ok) {
          throw new TossApiError(res.status, data, `Toss ${res.status} ${url}`);
        }

        // 모든 토스 응답은 envelope 형태로 옴 — 자동 unwrap
        if (data && typeof data === "object" && "resultType" in data) {
          const env = data as TossEnvelope<unknown>;
          if (env.resultType !== "SUCCESS") {
            const reason = env.error?.reason ?? "unknown";
            throw new TossApiError(
              res.status,
              data,
              `Toss ${env.error?.errorCode ?? "FAIL"} ${reason}`,
            );
          }
          return env.success as T;
        }
        return data as T;
      } catch (err) {
        // AbortError 또는 마지막 시도 — 그대로 throw
        if (err instanceof TossApiError) throw err;
        if (attempt >= maxRetries) throw err;
        lastErr = err;
        const backoff = Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 250);
        console.warn(`[toss] network error — retrying in ${backoff}ms (${String(err)})`);
        await sleep(backoff, p.signal);
      }
    }
    throw lastErr ?? new Error("[toss] unreachable");
  }

  return {
    /** 매장 정보 단건 조회 (가장 간단한 헬스체크용) */
    async getMerchant(opts: TossClientOptions = {}): Promise<unknown> {
      return request({ ...opts, path: "" });
    },

    /** 주문 목록 — page/size 페이지네이션 */
    async listOrders(
      params: TossOrderListParams = {},
      opts: TossClientOptions = {},
    ): Promise<unknown> {
      const query: Record<string, string | number | string[] | undefined> = {
        from: params.from,
        to: params.to,
        page: params.page,
        size: params.size,
        sortOrder: params.sortOrder,
      };
      if (params.orderStates?.length) query.orderStates = params.orderStates;
      if (params.sources?.length) query.sources = params.sources;
      return request({ ...opts, path: "/order/orders", query });
    },

    /** 주문 단건 조회 */
    async getOrder(orderId: string, opts: TossClientOptions = {}): Promise<TossOrder> {
      return request<TossOrder>({
        ...opts,
        path: `/order/orders/${encodeURIComponent(orderId)}`,
      });
    },

    /** 카탈로그 상품 목록 */
    async listCatalogItems(
      params: { page?: number; size?: number } = {},
      opts: TossClientOptions = {},
    ): Promise<unknown> {
      return request({
        ...opts,
        path: "/catalog/items",
        query: { page: params.page, size: params.size },
      });
    },

    /** 카탈로그 상품 단건 */
    async getCatalogItem(itemId: string, opts: TossClientOptions = {}): Promise<TossCatalogItem> {
      return request<TossCatalogItem>({
        ...opts,
        path: `/catalog/items/${encodeURIComponent(itemId)}`,
      });
    },

    /**
     * 페이지네이션을 자동 순회하는 헬퍼 (Order list).
     * envelope.success가 항상 배열이라는 가정. (page에 데이터가 size 미만이면 마지막)
     */
    async *iterateOrders(
      params: TossOrderListParams = {},
      opts: TossClientOptions = {},
    ): AsyncGenerator<TossOrder, void, void> {
      let page = params.page ?? 1;
      const size = params.size ?? 100;
      while (true) {
        const list = (await this.listOrders({ ...params, page, size }, opts)) as TossOrder[];
        if (!Array.isArray(list) || list.length === 0) break;
        for (const order of list) yield order;
        if (list.length < size) break;
        page += 1;
      }
    },

    /** 카탈로그 상품 전체 순회 */
    async *iterateCatalogItems(
      opts: TossClientOptions = {},
    ): AsyncGenerator<TossCatalogItem, void, void> {
      let page = 1;
      const size = 100;
      while (true) {
        const list = (await this.listCatalogItems({ page, size }, opts)) as TossCatalogItem[];
        if (!Array.isArray(list) || list.length === 0) break;
        for (const item of list) yield item;
        if (list.length < size) break;
        page += 1;
      }
    },
  };
}

export type TossClient = ReturnType<typeof tossClient>;
