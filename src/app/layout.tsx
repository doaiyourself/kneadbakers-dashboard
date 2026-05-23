import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KNEAD Analytics",
  description: "니드 베이커스 매출 분석 시스템 — 토스플레이스 Open API 기반 실시간 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
