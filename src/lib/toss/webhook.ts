/**
 * 토스플레이스 Webhook 서명 검증.
 *
 * 검증식: HMAC-SHA256( secret, `${timestamp}.${rawBody}` ) === x-toss-signature
 * timestamp는 ±5분 이내여야 함 (replay 공격 방지).
 *
 * 참조: https://docs.tossplace.com/reference/open-api/webhook.html
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** 기본 허용 시간 차 — ±5분 */
const DEFAULT_TOLERANCE_SEC = 300;

export interface VerifyWebhookParams {
  /** 헤더 `x-toss-signature` 원본 값 (대개 hex 또는 base64) */
  signature: string | null | undefined;
  /** 헤더 `x-toss-timestamp` (epoch ms 추정, 또는 ISO) */
  timestamp: string | null | undefined;
  /** Request body raw bytes (절대 JSON.stringify 한 결과 쓰지 말 것 — 토스가 보낸 그대로의 byte 시퀀스) */
  rawBody: string;
  /** TOSS_WEBHOOK_SECRET */
  secret: string;
  /** ±tolerance 초 — 기본 300 (5분) */
  toleranceSec?: number;
  /** 현재 시각 주입 (테스트용). 기본 Date.now() */
  now?: () => number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing-headers" | "stale-timestamp" | "bad-signature" };

/**
 * 서명 검증.
 * - 시그니처가 hex/base64 어느 쪽이든 길이 맞으면 비교 (양쪽 다 시도).
 * - timing-safe 비교 사용.
 */
export function verifyTossWebhook(p: VerifyWebhookParams): VerifyResult {
  if (!p.signature || !p.timestamp || !p.secret) {
    return { ok: false, reason: "missing-headers" };
  }

  // timestamp 파싱 — epoch ms 또는 ISO 둘 다 시도
  const tsNum = Number(p.timestamp);
  const ts = Number.isFinite(tsNum) ? tsNum : Date.parse(p.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "missing-headers" };
  const now = (p.now ?? Date.now)();
  const toleranceMs = (p.toleranceSec ?? DEFAULT_TOLERANCE_SEC) * 1000;
  if (Math.abs(now - ts) > toleranceMs) {
    return { ok: false, reason: "stale-timestamp" };
  }

  // message = timestamp + "." + rawBody (UTF-8)
  const message = `${p.timestamp}.${p.rawBody}`;
  const expected = createHmac("sha256", p.secret).update(message, "utf8").digest();
  const expectedHex = expected.toString("hex");
  const expectedBase64 = expected.toString("base64");

  if (
    safeEqStr(p.signature, expectedHex) ||
    safeEqStr(p.signature, expectedBase64) ||
    // 일부 구현은 "sha256=..." 프리픽스를 붙임
    (p.signature.startsWith("sha256=") &&
      (safeEqStr(p.signature.slice(7), expectedHex) ||
        safeEqStr(p.signature.slice(7), expectedBase64)))
  ) {
    return { ok: true };
  }
  return { ok: false, reason: "bad-signature" };
}

/** 길이 다르면 false, 같으면 timing-safe 비교 */
function safeEqStr(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}
