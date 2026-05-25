import { signIn, auth, isGoogleEnabled } from "@/lib/auth";
import { redirect } from "next/navigation";

type SearchParams = { next?: string; error?: string };

/**
 * 로그인 페이지 — 카카오 + Google OAuth.
 * 이미 로그인된 사용자는 next(또는 /)로 리다이렉트.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams> | SearchParams;
}) {
  const params = await searchParams;
  const session = await auth();
  const next = params?.next && params.next.startsWith("/") ? params.next : "/";
  if (session?.user) redirect(next);

  async function loginWithKakao() {
    "use server";
    await signIn("kakao", { redirectTo: next });
  }

  async function loginWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: next });
  }

  const errorMessage = params?.error ? mapAuthError(params.error) : null;
  const googleEnabled = isGoogleEnabled();

  return (
    <div className="grid min-h-screen place-items-center bg-brand-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-4xl">🌾</div>
          <h1 className="mt-3 font-serif text-2xl font-semibold">KNEAD Analytics</h1>
          <p className="mt-1 text-xs text-muted-foreground">니드 베이커스 매출 분석 대시보드</p>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        <div className="space-y-2">
          <form action={loginWithKakao}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#FEE500] px-4 py-3 text-sm font-medium text-[#191600] transition-opacity hover:opacity-90"
            >
              <KakaoIcon />
              <span>카카오로 로그인</span>
            </button>
          </form>

          {googleEnabled && (
            <form action={loginWithGoogle}>
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-white px-4 py-3 text-sm font-medium text-[#3c4043] transition-opacity hover:opacity-90"
              >
                <GoogleIcon />
                <span>Google로 로그인</span>
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          등록된 계정만 접근할 수 있습니다.
          <br />
          매출 데이터 보호를 위해 점주가 추가한 사용자만 로그인 가능합니다.
        </p>
      </div>
    </div>
  );
}

function mapAuthError(code: string): string {
  switch (code) {
    case "AccessDenied":
      return "권한이 없는 계정입니다. 점주에게 계정 등록을 요청하세요.";
    case "Configuration":
      return "서버 설정 오류 — 관리자에게 문의해 주세요.";
    case "OAuthCallbackError":
    case "OAuthSignInError":
      return "로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return "로그인에 실패했습니다.";
  }
}

function KakaoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.84 5.33 4.63 6.78l-.97 3.55c-.09.33.27.59.56.41l4.26-2.81c.5.06 1.01.09 1.52.09 5.52 0 10-3.58 10-8s-4.48-8-10-8z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20.4H24v7.2h11.3c-1.5 4.2-5.5 7.2-11.3 7.2-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.1-5.1C33.7 5.9 29.1 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.6-8 19.6-20 0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l5.9 4.3C13.9 16 18.6 13 24 13c3.1 0 5.8 1.2 7.9 3.1l5.1-5.1C33.7 5.9 29.1 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5 0 9.5-1.7 13-4.7l-6-5.1c-1.9 1.3-4.4 2-7 2-5.8 0-10.7-3.9-12.5-9.2l-5.9 4.6C8.9 39.5 15.9 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20.4H24v7.2h11.3c-.7 2-2 3.7-3.7 4.9l6 5.1C40.7 33.7 44 28.9 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
