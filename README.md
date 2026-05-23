# KNEAD Analytics

니드 베이커스(상도역 1번 출구 베이커리 카페) 매출 분석 시스템.
토스플레이스 Open API + Webhook을 기반으로 한 단일 매장 실시간 분석 웹앱.

- 공식 토스 문서: <https://docs.tossplace.com/reference/open-api/intro.html>
- 데이터 소스: 토스플레이스 Open API + Webhook (엑셀 사용 안 함)
- 단일 매장 (멀티 테넌트 X)

## 스택

- **Next.js 14** (App Router, TypeScript strict, src 디렉토리)
- **Tailwind CSS** + **shadcn/ui** + **lucide-react**
- **Recharts** (차트)
- **PostgreSQL 16 + TimescaleDB** (hypertable: orders, payments)
- **Drizzle ORM** + drizzle-kit (postgres 드라이버)
- **NextAuth v5** (Kakao OAuth, owner/manager/staff 권한)
- **zod** / **date-fns** + date-fns-tz (Asia/Seoul)
- **Vercel Cron** (`/api/cron/*` 보호: `CRON_SECRET`)
- **vitest** + happy-dom (단위/UI 스모크)

## 폴더 구조

```
src/
  app/
    (auth)/login/            로그인
    (dashboard)/             앱 메인 (사이드바 + 탑바 레이아웃)
      page.tsx               홈 대시보드
      sales/                 매출 분석
      products/              상품 분석 (+ [id])
      channels/              채널 분석
      payments/              결제수단 분석
      orders/                주문 조회
      settings/              설정 (owner 전용)
    api/
      dashboard/             요약·실시간
      sales/                 매출 시계열·히트맵
      products/              상품 랭킹·동시구매·카니발리제이션
      channels/              채널별 분석
      payments/              결제수단 분석
      orders/                주문 조회
      webhooks/toss/         토스 웹훅 수신
      admin/sync/            backfill 등 관리
      cron/                  hourly-poll, daily-reconcile
      auth/[...nextauth]/    NextAuth
  components/
    ui/                      shadcn/ui
    charts/                  Recharts 래퍼
    layout/                  Sidebar, TopBar
  lib/
    db/                      Drizzle schema, client, migrations, seed
    toss/                    토스 Open API 클라이언트, 타입, 웹훅 검증, normalize
    analytics/               분석 SQL 헬퍼
    auth.ts                  NextAuth 설정
    config.ts                서버 env 스키마, 상수
    utils.ts                 cn, formatKRW 등
  scripts/                   test-toss-connection, test-webhook 등
  styles/
```

## 로컬 개발 셋업

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수

```bash
cp .env.local.example .env.local
# 토스 키, DATABASE_URL, NEXTAUTH_SECRET, CRON_SECRET 채우기
```

> `NEXTAUTH_SECRET` / `CRON_SECRET`은 `openssl rand -base64 32`로 생성.

### 3. PostgreSQL

옵션 A — Neon/Railway/Supabase: 콘솔에서 DB 생성 후 `DATABASE_URL` 복사.
옵션 B — 로컬 Docker:

```bash
docker run -d --name knead-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=knead \
  -p 5432:5432 \
  timescale/timescaledb:latest-pg16
```

### 4. 마이그레이션

```bash
npm run db:generate   # 스키마 변경 시 마이그레이션 SQL 생성 (src/lib/db/migrations)
npm run db:migrate    # 적용
# 또는 빠른 동기화 (개발 전용 — 마이그레이션 파일 안 생김)
npm run db:push
```

> **TimescaleDB 변환은 별도 적용** — 위 명령으로 일반 PG 테이블이 만들어진 뒤,
> 다음을 실행해 hypertable로 변환 (확장이 없으면 graceful skip):
>
> ```bash
> psql "$DATABASE_URL" -f src/lib/db/migrations/000_timescale_init.sql
> psql "$DATABASE_URL" -f src/lib/db/migrations/999_materialized_views.sql
> ```
>
> 매테리얼라이즈드 뷰(`daily_sales`, `hourly_heatmap`, `product_daily_sales`)는
> 매일 새벽 4시 daily-reconcile cron 끝에 `REFRESH MATERIALIZED VIEW CONCURRENTLY ...`로 갱신.

### 5. 시드 (개발용)

```bash
npm run db:seed       # 초기 owner + 가짜 주문 1,000건
```

### 6. 개발 서버

```bash
npm run dev
# → http://localhost:3000
```

## 카카오 로그인 설정

매출 데이터 보호를 위해 카카오 OAuth 단독 로그인. 등록된 카카오 계정만 접근 가능.

### 1) 카카오 개발자센터에서 앱 등록

1. <https://developers.kakao.com/console/app> 접속 → "애플리케이션 추가하기"
2. 앱 키 → **REST API 키**를 `KAKAO_CLIENT_ID`로 사용
3. **제품 설정 → 카카오 로그인** → 활성화 ON
4. **카카오 로그인 → Redirect URI**에 다음 등록:
   - `http://localhost:3000/api/auth/callback/kakao` (개발용)
   - `https://<배포 도메인>/api/auth/callback/kakao` (운영용)
5. **카카오 로그인 → 동의항목**:
   - 닉네임: 필수
   - 프로필 사진: 선택
   - **카카오계정(이메일)**: 필수 또는 선택 (화이트리스트를 이메일로 관리할 거면 필수 권장)
6. **보안 → Client Secret 코드 → 생성 → 활성** → `KAKAO_CLIENT_SECRET`로 사용

### 2) `.env.local`에 키 입력

```bash
NEXTAUTH_SECRET=...        # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
KAKAO_CLIENT_ID=...        # REST API 키
KAKAO_CLIENT_SECRET=...    # Client Secret 코드
OWNER_KAKAO_EMAILS=owner@kakao.com  # 콤마 구분, 여기 들어간 카카오 이메일만 owner 자동 부여
```

### 3) 접근 제어 모드

| 환경 | OWNER_KAKAO_EMAILS / OWNER_KAKAO_IDS | 동작 |
| --- | --- | --- |
| 운영 권장 | 값 있음 | 화이트리스트 매칭 시 `owner` 가입, 그 외 거부. 추가 사용자는 owner가 settings에서 등록 |
| 개발 편의 | 비어 있음 | **TOFU 모드**: 첫 로그인 사용자가 자동 `owner`. 이후 새 카카오 가입은 거부 |

> 운영 배포 전 반드시 `OWNER_KAKAO_EMAILS`(또는 `OWNER_KAKAO_IDS`)를 채울 것.

### 4) Kakao 사용자 ID 확인 (선택)

이메일 동의가 어려운 경우 카카오 사용자 ID(숫자)로 화이트리스트 가능:

1. 한 번 로그인 시도 → DB `users.kakao_id`에서 본인 ID 확인
2. `.env.local`의 `OWNER_KAKAO_IDS`에 해당 ID 추가
3. 이메일 화이트리스트는 비워두기

## 토스플레이스 API 발급 절차

1. <https://developers.tossplace.com/> 가입
2. 애플리케이션 생성 → **API Access Key / Secret Key** 발급 → `.env.local`에 입력
3. **Webhook Secret Key** 발급 + 수신 URL 등록 (예: `https://<domain>/api/webhooks/toss`)
4. 매장 ID(`merchantId`) 확인 → `TOSS_MERCHANT_ID`에 입력
5. 방화벽: 토스 송신 IP `15.165.6.198` 허용 (수신 서버 인바운드)

## 배포

- **Vercel** (앱): 환경 변수 등록 + `vercel.json` 크론 (1시간 폴링, 일 reconcile)
- **DB**: Neon / Railway / Supabase
- 첫 배포 후 `/api/admin/sync/backfill`로 직전 30~90일치 일괄 적재
- `npm run db:push` 또는 마이그레이션으로 스키마 적용

## 트러블슈팅

| 증상 | 원인 / 조치 |
| --- | --- |
| 웹훅 401 | 서명 검증 실패. `TOSS_WEBHOOK_SECRET` 일치 여부, timestamp ±5분 확인 |
| 429 | 호출량 제한 도달. 폴링 빈도 축소, `x-ratelimit-reset`까지 대기 |
| 동기화 누락 | `sync_jobs` 테이블 + `webhook_events`에서 실패 이벤트 확인, backfill 재실행 |
| `merchantId` 불일치 | env의 `TOSS_MERCHANT_ID`와 토스 콘솔의 매장 ID 동일한지 |

## 진행 상태

- [x] 프롬프트 0: Next.js 14 초기 셋업
- [x] 프롬프트 1: DB 스키마 + Drizzle
- [ ] 프롬프트 2: 토스 API 클라이언트
- [ ] 프롬프트 3: 웹훅 + 동기화 잡
- [ ] 프롬프트 4: Analytics API
- [ ] 프롬프트 5: 대시보드 메인
- [ ] 프롬프트 6: 분석 화면 4개
- [ ] 프롬프트 7: 인증 + 설정
- [ ] 프롬프트 8: 안정화 + 배포
