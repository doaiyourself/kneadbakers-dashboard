/**
 * 홈 대시보드 — 프롬프트 5에서 정식 구현.
 * 지금은 셋업 검증용 placeholder.
 */
export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">KNEAD Analytics</h1>
        <p className="text-sm text-muted-foreground">
          니드 베이커스 매출 분석 대시보드 — 셋업 완료. 다음 단계: DB 스키마 → 토스 API 연동.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "매출", value: "—", hint: "오늘" },
          { label: "결제 건수", value: "—", hint: "오늘" },
          { label: "객단가", value: "—", hint: "오늘" },
          { label: "취소", value: "—", hint: "오늘" },
        ].map((m) => (
          <div
            key={m.label}
            className="rounded-lg border border-border bg-card p-5 shadow-sm"
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{m.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{m.hint}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
        <div className="text-3xl">🌾</div>
        <p className="mt-3 text-sm text-muted-foreground">
          오늘은 아직 반죽 전이에요. 토스 API 연동 후 실시간 데이터가 표시됩니다.
        </p>
      </div>
    </div>
  );
}
