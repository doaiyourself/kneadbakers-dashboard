/**
 * 클라이언트·서버 양쪽에서 쓰는 데이터 변환 헬퍼.
 * 차트 컴포넌트 (use client) 와 분리되어 server component에서도 호출 가능.
 */

/** 시계열에 N일 이동평균(`ma7` 키) 추가 */
export function withMovingAverage<T extends { revenue: number }>(
  series: T[],
  window = 7,
): Array<T & { ma7: number | undefined }> {
  return series.map((p, i) => {
    if (i < window - 1) return { ...p, ma7: undefined };
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) {
      sum += series[j]!.revenue;
    }
    return { ...p, ma7: Math.round(sum / window) };
  });
}
