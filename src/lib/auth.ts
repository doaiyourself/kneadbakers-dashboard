import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Kakao from "next-auth/providers/kakao";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, type UserRole } from "@/lib/db/schema";
import { getKakaoWhitelist, getServerEnv } from "@/lib/config";

/**
 * NextAuth v5 + Kakao OAuth.
 *
 * 흐름:
 * 1) 사용자가 /login에서 "카카오로 로그인" 클릭 → signIn("kakao") 호출
 * 2) Kakao OAuth 콜백 → signIn 콜백에서 화이트리스트 검증 + DB 업서트
 * 3) jwt 콜백에서 role을 토큰에 부착
 * 4) session 콜백에서 user.role, user.kakaoId, user.dbId 를 세션에 부착
 *
 * 화이트리스트(OWNER_KAKAO_EMAILS / OWNER_KAKAO_IDS)가 명시되어 있으면:
 *   - 매칭되는 카카오 계정만 owner 로 가입/로그인
 *   - 매칭 안 되는 계정은 거부 (settings에서 매니저가 추가 등록한 사용자는 통과)
 * 둘 다 비어 있으면 TOFU 모드: 첫 사용자가 owner, 이후 가입은 모두 staff.
 */

declare module "next-auth" {
  interface Session {
    user: {
      dbId: number;
      kakaoId: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    dbId?: number;
    kakaoId?: string;
    role?: UserRole;
  }
}

function getAuthConfig(): NextAuthConfig {
  const env = getServerEnv();
  // dev에서 .env.local이 비어도 모듈 로드는 통과시킨다. 실제 signIn 시점에 Kakao가 거부.
  const kakaoId = env.KAKAO_CLIENT_ID || "missing-kakao-client-id";
  const kakaoSecret = env.KAKAO_CLIENT_SECRET || "missing-kakao-client-secret";
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET || "dev-insecure-secret-do-not-use-in-prod";
  return {
    providers: [
      Kakao({
        clientId: kakaoId,
        clientSecret: kakaoSecret,
      }),
    ],
    secret,
    // Vercel/플랫폼이 NEXTAUTH_URL을 안 줘도 X-Forwarded-Host로부터 호스트 추론 허용.
    trustHost: true,
    session: { strategy: "jwt" },
    pages: { signIn: "/login", error: "/login" },
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== "kakao" || !profile) return false;

        const kakaoId = String(profile.id ?? "");
        if (!kakaoId) return false;

        // Kakao profile shape: { id, kakao_account: { email, profile: { nickname, profile_image_url } } }
        // 타입이 자주 바뀌어서 unknown 캐스팅으로 안전하게 접근.
        const p = profile as unknown as {
          id?: number | string;
          kakao_account?: {
            email?: string;
            profile?: { nickname?: string; profile_image_url?: string };
          };
          properties?: { nickname?: string; profile_image?: string };
        };
        const email = p.kakao_account?.email?.toLowerCase() ?? null;
        const name = p.kakao_account?.profile?.nickname ?? p.properties?.nickname ?? null;
        const imageUrl =
          p.kakao_account?.profile?.profile_image_url ?? p.properties?.profile_image ?? null;

        const whitelist = getKakaoWhitelist();

        const existing = await db
          .select()
          .from(users)
          .where(eq(users.kakaoId, kakaoId))
          .limit(1);
        const existingUser = existing[0];

        if (existingUser) {
          if (!existingUser.isActive) return false;
          // 프로필 정보 갱신 + 마지막 로그인 기록
          await db
            .update(users)
            .set({
              email,
              name,
              imageUrl,
              lastLoginAt: new Date(),
            })
            .where(eq(users.id, existingUser.id));
          return true;
        }

        // 신규 사용자 — 화이트리스트 검증
        let role: UserRole = "staff";
        if (whitelist.isExplicit) {
          const ownerByEmail = email && whitelist.emails.includes(email);
          const ownerById = whitelist.ids.includes(kakaoId);
          if (!ownerByEmail && !ownerById) {
            // 화이트리스트에 없는 신규 카카오 로그인 → 거부
            console.warn(
              `[auth] denied: kakaoId=${kakaoId} email=${email ?? "-"} not in whitelist`,
            );
            return false;
          }
          role = "owner";
        } else {
          // TOFU: 첫 사용자가 owner, 이후는 staff
          const anyUser = await db.select({ id: users.id }).from(users).limit(1);
          if (anyUser.length === 0) {
            role = "owner";
            console.warn(
              "[auth] TOFU mode: no whitelist configured — first sign-in granted owner role. " +
                "Set OWNER_KAKAO_EMAILS or OWNER_KAKAO_IDS in env for production.",
            );
          } else {
            // 화이트리스트 없는데 이미 사용자가 있으면 자동가입 금지 — owner가 settings에서 추가해야 함
            console.warn(
              `[auth] denied: kakaoId=${kakaoId} — TOFU owner exists. ` +
                "Add this user via settings or whitelist env.",
            );
            return false;
          }
        }

        await db.insert(users).values({
          kakaoId,
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
        // 최초 로그인 시점에 token에 kakaoId/role/dbId 부착
        if (account?.provider === "kakao" && profile) {
          const kakaoId = String((profile as { id?: number | string }).id ?? "");
          if (kakaoId) {
            const dbUser = (
              await db.select().from(users).where(eq(users.kakaoId, kakaoId)).limit(1)
            )[0];
            if (dbUser) {
              token.kakaoId = kakaoId;
              token.dbId = dbUser.id;
              token.role = dbUser.role as UserRole;
            }
          }
        }
        return token;
      },

      async session({ session, token }) {
        if (token.kakaoId) session.user.kakaoId = token.kakaoId;
        if (typeof token.dbId === "number") session.user.dbId = token.dbId;
        if (token.role) session.user.role = token.role;
        return session;
      },
    },
  };
}

const handler = NextAuth(getAuthConfig());

export const { handlers, auth, signIn, signOut } = handler;

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
