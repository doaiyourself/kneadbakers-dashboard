export default function SalesPage() {
  return (
    <PlaceholderPage
      title="매출 분석"
      caption="프롬프트 6에서 일별 매출 라인, 요일×시간 히트맵, 전월 대비표가 들어옵니다."
    />
  );
}

function PlaceholderPage({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="space-y-2">
      <h1 className="font-serif text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{caption}</p>
    </div>
  );
}
