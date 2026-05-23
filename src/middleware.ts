import { auth } from "@/lib/auth";

/**
 * 라우트 보호. /login, /api/auth/*, 정적 파일을 제외한 모든 경로는 로그인 필요.
 * 미로그인 사용자는 /login 으로 리다이렉트.
 */
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  // 공개 경로
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return;
  }

  // 웹훅 / cron은 별도 인증(서명 / Bearer) 사용 — 미들웨어 통과
  if (pathname.startsWith("/api/webhooks/") || pathname.startsWith("/api/cron/")) {
    return;
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return Response.redirect(loginUrl);
  }
});

export const config = {
  // _next 정적 파일과 확장자 있는 파일(이미지/폰트 등)은 제외
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
