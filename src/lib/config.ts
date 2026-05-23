import { z } from "zod";

/**
 * 서버 전용 환경 변수 스키마. 클라이언트 번들에 노출되면 안 됨.
 * Next.js Route Handler/Server Component에서만 import.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Toss는 프롬프트 2부터 사용. 그 전엔 optional — 토스 클라이언트 생성 시점에서 다시 검증.
  TOSS_BASE_URL: z.string().url().default("https://open-api.tossplace.com/api-public/openapi/v1"),
  TOSS_ACCESS_KEY: z.string().optional(),
  TOSS_SECRET_KEY: z.string().optional(),
  TOSS_WEBHOOK_SECRET: z.string().optional(),
  TOSS_MERCHANT_ID: z.string().optional(),

  // --- NextAuth v5 + Kakao OAuth ---
  // NextAuth v5는 AUTH_SECRET을 우선, 폴백으로 NEXTAUTH_SECRET 사용.
  AUTH_SECRET: z.string().min(1).optional(),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  // Vercel은 NEXTAUTH_URL을 자동 추론(trustHost). 로컬에서만 http://localhost:3000.
  NEXTAUTH_URL: z.string().url().optional(),
  KAKAO_CLIENT_ID: z.string().min(1, "KAKAO_CLIENT_ID is required"),
  KAKAO_CLIENT_SECRET: z.string().min(1, "KAKAO_CLIENT_SECRET is required"),

  // 카카오 계정 화이트리스트 (콤마 구분). 이 이메일/ID로 로그인하면 owner 자동 부여.
  // 둘 중 하나라도 채워져 있으면 화이트리스트 모드 활성화 — 그 외 로그인은 거부.
  // 둘 다 비어 있으면 첫 로그인 사용자가 owner가 되는 TOFU 모드 (개발 편의).
  OWNER_KAKAO_EMAILS: z.string().optional().default(""),
  OWNER_KAKAO_IDS: z.string().optional().default(""),

  CRON_SECRET: z.string().min(1, "CRON_SECRET is required"),

  SLACK_WEBHOOK_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().email().optional(),
});

type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * 서버 환경변수 안전 로드. 클라이언트에서 호출하면 throw.
 *
 * 모드별 동작:
 * - production / build phase: strict 검증. 누락 시 throw.
 * - development: 누락 시 한 번만 경고 출력 후 partial 값으로 진행 (boot 가능).
 *   실제로 그 값을 사용하는 시점(예: 토스 API 호출, DB 쿼리)에서 자연스럽게 실패.
 * - 명시적 strict가 필요하면 STRICT_ENV=1.
 */
let warnedOnce = false;

/** 빈 문자열을 undefined로 정규화 — dotenv가 `KEY=` 를 ""로 로드해서 .min(1) 검증에 걸리는 문제 회피 */
function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = v === "" ? undefined : v;
  }
  return out;
}

export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must not be called in the browser");
  }
  if (cached) return cached;

  const skip =
    process.env.SKIP_ENV_VALIDATION === "1" ||
    process.env.NEXT_PHASE === "phase-production-build";
  const isDev = process.env.NODE_ENV !== "production";
  const strict = process.env.STRICT_ENV === "1";
  const normalized = normalizeEnv(process.env);

  if (skip) {
    cached = serverEnvSchema.partial().parse(normalized) as ServerEnv;
    return cached;
  }

  const parsed = serverEnvSchema.safeParse(normalized);
  if (!parsed.success) {
    if (isDev && !strict) {
      if (!warnedOnce) {
        const formatted = parsed.error.issues
          .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        console.warn(
          `\n[config] dev 모드 — 다음 환경변수가 비어 있습니다. .env.local 채우기 전까지 해당 기능은 동작하지 않습니다:\n${formatted}\n`,
        );
        warnedOnce = true;
      }
      cached = serverEnvSchema.partial().parse(normalized) as ServerEnv;
      return cached;
    }
    const formatted = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * 카카오 화이트리스트 파싱. 이메일/ID 둘 다 콤마 구분, 공백 제거, 소문자(이메일).
 * 둘 다 비어 있으면 TOFU 모드.
 */
export function getKakaoWhitelist() {
  const env = getServerEnv();
  const emails = (env.OWNER_KAKAO_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const ids = (env.OWNER_KAKAO_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    emails,
    ids,
    /** 화이트리스트가 명시적으로 설정되어 있는지 */
    isExplicit: emails.length > 0 || ids.length > 0,
  };
}

/** Asia/Seoul 타임존 상수 */
export const TIMEZONE = "Asia/Seoul" as const;

/** 토스 송신 IP (방화벽 화이트리스트 안내용) */
export const TOSS_WEBHOOK_SOURCE_IP = "15.165.6.198" as const;

/** 영업시간 (시간대 히트맵 기본 범위) */
export const BUSINESS_HOURS = { start: 7, end: 23 } as const;
