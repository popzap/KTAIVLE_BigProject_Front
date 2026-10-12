import type { Metadata } from "next";
import "./globals.css";
import { RunProvider } from "@/lib/omnisite/RunProvider";
import { Header } from "@/components/shell/Header";
import { Footer } from "@/components/shell/Footer";
import { ReviewBanner } from "@/components/shell/ReviewBanner";
import { DemoBanner, DemoGate } from "@/components/shell/DemoBanner";

import { ProgressSidebar } from "@/components/shell/ProgressSidebar";
import { ScaleToFit } from "@/components/shell/ScaleToFit";

export const metadata: Metadata = {
  title: "OmniSite — 갈등시설 입지 선정",
  description: "B2G 공간의사결정지원(SDSS). GIS 최적화 + 공청회 시뮬레이션.",
};

// 15" 기준(사용자 지정, 2026-08-12). `ScaleToFit` 참고 — 이보다 작은 화면(13" 등)
// 에서만 비율을 유지한 채 줄어든다. 안쪽 레이아웃은 항상 이 크기로 그려진다.
const BASE_WIDTH = 1512;
const BASE_HEIGHT = 982;

/**
 * 웹폰트를 안 쓴다.
 * `next/font/google` 은 빌드 시 구글에 나간다. 이 프로젝트는 폐쇄망 납품이
 * 전제(B2G)라, 개발 중에만 되는 의존성을 처음부터 넣지 않는다. 한글 본문은
 * OS 기본 산세리프가 가장 잘 읽힌다.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="antialiased">
      <body>
        <ScaleToFit baseWidth={BASE_WIDTH} baseHeight={BASE_HEIGHT}>
          <div className="h-full flex flex-col overflow-hidden">
            <RunProvider>
              <Header />
              {/* DEMO 모드에서만 보인다(실제 실행 기록 재생). */}
              <DemoBanner />
              {/* 다시보기 중에만 보인다. 그 외에는 아무 자리도 안 차지한다. */}
              <ReviewBanner />
              <div className="flex flex-1 relative min-h-0">
                <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
                  <DemoGate>{children}</DemoGate>
                </main>
                <ProgressSidebar />
              </div>
              <Footer />
            </RunProvider>
          </div>
        </ScaleToFit>
      </body>
    </html>
  );
}
