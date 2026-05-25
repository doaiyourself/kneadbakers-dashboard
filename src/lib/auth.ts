import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Kakao from "next-auth/providers/kakao";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, type UserRole } from "@/lib/db/schema";
import {
  getGoogleWhitelist,
  getKakaoWhitelist,
  getServerEnv,
  isGoogleAuthEnabled,
} from "@/lib/config";

/**
 * NextAuth v5 + Kakao/Google OAuth.
 *
 * 흐름:
 * 1) /login → "카카오/Google로 로그인" 클릭 → signIn(provider) 호출
 * 2) OAuth 콜백 → signIn 콜백에서 화이트리스트 검증 + DB 업서트/링크
 * 3) jwt 콜백에서 role/식별자를 토큰에 부착
 * 4) session 콜백에서 user.role, user.dbId 등 부착
 *
 * 화이트리스트 정책:
 *   - OWNER_KAKAO_EMAILS / OWNER_KAKAO_IDS: 카카오 신규 가입 자동 owner
 *   - OWNER_GOOGLE_EMAILS: Google 신규 가입 자동 owner
 *   - 같은 이메일로 이미 등록된 사용자가 있으면 새 provider id를 그 row에 link (cross-provider).
 *   - 어느 화이트리스트와도 매칭 안 되고 매칭되는 기존 유저도 없으면 거부.
 *   - 카카오 화이트리스트 둘 다 비고 사용자 0명이면 TOFU 모드(개발 편의): 첫 카카오 로그인 owner.
 */

declare module "next-auth" {
  interface Session {
    user: {
      dbId: number;
      provider: "kakao" | "google";
      kakaoId?: string;
      googleId?: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    dbId?: number;
    provider?: "kakao" | "google";
    kakaoId?: string;
    googleId?: string;
    role?: UserRole;
  }
}

/** provider 별 profile에서 정규화된 정보 추출. id는 항상 string. */
type NormalizedProfile = {
  providerId: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
};

function normalizeKakao(profile: unknown): NormalizedProfile | null {
  const p = profile as {
    id?: number | string;
    kakao_account?: {
      email?: string;
      profile?: { nickname?: string; profile_image_url?: string };
    };
    properties?: { nickname?: string; profile_image?: string };
  };
  const providerId = String(p.id ?? "");
  if (!providerId) return null;
  return {
    providerId,
    email: p.kakao_account?.email?.toLowerCase() ?? null,
    name: p.kakao_account?.profile?.nickname ?? p.properties?.nickname ?? null,
    imageUrl:
      p.kakao_account?.profile?.profile_image_url ?? p.properties?.profile_image ?? null,
  };
}

function normalizeGoogle(profile: unknown): NormalizedProfile | null {
  const p = profile as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  const providerId = String(p.sub ?? "");
  if (!providerId) return null;
  // Google은 email_verified false면 신뢰 안 함 (cross-provider 링크 방지)
  const emailOk = p.email && p.email_verified !== false;
  return {
    providerId,
    email: emailOk ? (p.email ?? "").toLowerCase() : null,
    name: p.name ?? null,
    imageUrl: p.picture ?? null,
  };
}

function getAuthConfig(): NextAuthConfig {
  const env = getServerEnv();
  // dev에서 .env.local이 비어도 모듈 로드는 통과시킨다. 실제 signIn 시점에 provider가 거부.
  const kakaoId = env.KAKAO_CLIENT_ID || "missing-kakao-client-id";
  const kakaoSecret = env.KAKAO_CLIENT_SECRET || "missing-kakao-client-secret";
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET || "dev-insecure-secret-do-not-use-in-prod";

  const providers: NextAuthConfig["providers"] = [
    Kakao({ clientId: kakaoId, clientSecret: kakaoSecret }),
  ];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // 명시적 동의 화면을 매번 — refresh token 안정성 필요하면 prompt: 'consent'로 바꿔도 됨
        authorization: { params: { prompt: "select_account" } },
      }),
    );
  }

  return {
    providers,
    secret,
    trustHost: true,
    session: { strategy: "jwt" },
    pages: { signIn: "/login", error: "/login" },
    callbacks: {
      async signIn({ account, profile }) {
        if (!account || !profile) return false;
        const provider = account.provider;
        if (provider !== "kakao" && provider !== "google") return false;

        const norm =
          provider === "kakao" ? normalizeKakao(profile) : normalizeGoogle(profile);
        if (!norm) return false;
        const { providerId, email, name, imageUrl } = norm;

        const idCol = provider === "kakao" ? users.kakaoId : users.googleId;

        // 1) 이미 이 provider id로 등록된 사용자
        const existing = (await db.select().from(users).where(eq(idCol, providerId)).limit(1))[0];
        if (existing) {
          if (!existing.isActive) return false;
          await db
            .update(users)
            .set({
              email: email ?? existing.email,
              name: name ?? existing.name,
              imageUrl: imageUrl ?? existing.imageUrl,
              lastLoginAt: new Date(),
            })
            .where(eq(users.id, existing.id));
          return true;
        }

        // 2) 같은 이메일로 다른 provider에 이미 등록된 사용자 — link (cross-provider)
        if (email) {
          const sameEmail = (
            await db.select().from(users).where(eq(users.email, email)).limit(1)
          )[0];
          if (sameEmail) {
            if (!sameEmail.isActive) return false;
            await db
              .update(users)
              .set({
                ...(provider === "kakao"
                  ? { kakaoId: providerId }
                  : { googleId: providerId }),
                name: name ?? sameEmail.name,
                imageUrl: imageUrl ?? sameEmail.imageUrl,
                lastLoginAt: new Date(),
              })
              .where(eq(users.id, sameEmail.id));
            console.info(
              `[auth] linked ${provider} (id=${providerId}) to existing user dbId=${sameEmail.id} via email`,
            );
            return true;
          }
        }

        // 3) 완전 신규 — 화이트리스트 검증
        let role: UserRole = "staff";
        if (provider === "kakao") {
          const wl = getKakaoWhitelist();
          if (wl.isExplicit) {
            const ok =
              (email && wl.emails.includes(email)) || wl.ids.includes(providerId);
            if (!ok) {
              console.warn(
                `[auth] denied kakao: id=${providerId} email=${email ?? "-"} not in whitelist`,
              );
              return false;
            }
            role = "owner";
          } else {
            // TOFU — 사용자가 한 명도 없으면 첫 카카오 로그인이 owner
            const any = await db.select({ id: users.id }).from(users).limit(1);
            if (any.length === 0) {
              role = "owner";
              console.warn(
                "[auth] TOFU: first kakao sign-in granted owner. Set OWNER_KAKAO_EMAILS in production.",
              );
            } else {
              console.warn(
                `[auth] denied kakao: id=${providerId} — TOFU owner exists, no whitelist`,
              );
              return false;
            }
          }
        } else {
          // google
          const wl = getGoogleWhitelist();
          if (!wl.isExplicit) {
            console.warn(
              `[auth] denied google: id=${providerId} email=${email ?? "-"} — OWNER_GOOGLE_EMAILS empty`,
            );
            return false;
          }
          const ok = email && wl.emails.includes(email);
          if (!ok) {
            console.warn(
              `[auth] denied google: id=${providerId} email=${email ?? "-"} not in whitelist`,
            );
            return false;
          }
          role = "owner";
        }

        await db.insert(users).values({
          kakaoId: provider === "kakao" ? providerId : null,
          googleId: provider === "google" ? providerId : null,
          email,
          name,
          imageUrl,
          role,
          isActive: true,
          lastLoginAt: new Date(),
        });
        return true;
      },

      async jwt({ token, profile, account }) {
        // 최초 로그인 시점에 token 채움
        if (account && profile && (account.provider === "kakao" || account.provider === "google")) {
          const provider = account.provider;
          const norm =
            provider === "kakao" ? normalizeKakao(profile) : normalizeGoogle(profile);
          if (norm) {
            const idCol = provider === "kakao" ? users.kakaoId : users.googleId;
            const dbUser = (
              await db.select().from(users).where(eq(idCol, norm.providerId)).limit(1)
            )[0];
            if (dbUser) {
              token.provider = provider;
              token.dbId = dbUser.id;
              token.role = dbUser.role as UserRole;
              if (dbUser.kakaoId) token.kakaoId = dbUser.kakaoId;
              if (dbUser.googleId) token.googleId = dbUser.googleId;
            }
          }
        }
        return token;
      },

      async session({ session, token }) {
        if (token.provider) session.user.provider = token.provider;
        if (typeof token.dbId === "number") session.user.dbId = token.dbId;
        if (token.role) session.user.role = token.role;
        if (token.kakaoId) session.user.kakaoId = token.kakaoId;
        if (token.googleId) session.user.googleId = token.googleId;
        return session;
      },
    },
  };
}

const handler = NextAuth(getAuthConfig());

export const { handlers, auth, signIn, signOut } = handler;

/** Google 로그인 버튼 표시 여부 결정용 (RSC에서 호출 가능) */
export function isGoogleEnabled() {
  return isGoogleAuthEnabled();
}

/** 역할 가드 — Route Handler/Server Component 시작 부분에서 호출 */
export async function requireRole(...allowed: UserRole[]) {
  const session = await auth();
  if (!session?.user?.role) {
    throw new Response("Unauthorized", { status: 401 });
  }
  if (!allowed.includes(session.user.role)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return session;
}
