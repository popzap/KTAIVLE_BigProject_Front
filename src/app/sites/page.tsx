"use client";

/**
 * 화면 4 · 위치 선정
 * ==================
 * **지도가 있는 유일한 화면이다.** 명세가 그렇게 정했다 — 다른 화면에 지도를
 * 붙이면 "어디"를 보는 화면이 여러 개가 되고, 사람은 어느 지도가 결정인지
 * 헷갈린다.
 *
 * 읽는 것
 *   score_grid.json  격자 중심점 + 점수 + 배제여부      → 지도 배경
 *   topN.csv         상위 후보 20곳 (**경도·위도가 여기에만 있다**) → 마커·표
 *   report.json      커버율 곡선 · 도달 개수            → 오른쪽 패널
 *
 * 🔴 `report.json > topn[]` 에는 **좌표가 없다**(실측). 그래서 마커는 반드시
 *    CSV 쪽이어야 한다. 두 곳의 순위·점수는 같지만 좌표는 한쪽에만 있으므로
 *    "report 에서 읽었다"고 적으면 그건 거짓 출처 기록이다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArtifactView2 } from "@/components/ui/ArtifactView";
import { GridMap, polygonsOf } from "@/components/map/GridMap";
import { PageFooter, PageHeader, SourceNote } from "@/components/ui/Page";
import { useArtifact } from "@/lib/omnisite/useArtifact";
import { useRun } from "@/lib/omnisite/RunProvider";
import { writeSitePick } from "@/lib/omnisite/sitePick";
import { DEMO, demoRecordedSite } from "@/lib/omnisite/demo";
import { loadExclusion, loadReport, loadScoreGrid, loadTopN, loadWeightSet } from "@/lib/omnisite/pipeline";
import { areaM2, fixed, int, percent } from "@/lib/omnisite/format";
import { jimokLabel } from "@/lib/omnisite/jimok";
import { SCREENS } from "@/lib/omnisite/screens";
import type { ExclusionDoc, ReportDoc, ScoreGridDoc, TopNCsvRow, WeightSetDoc } from "@/lib/omnisite/types";

const SCREEN = SCREENS.find((s) => s.no === "4")!;

/**
 * 지도가 **실제로 면으로 그린** 배제 레이어 수. 도구줄·범례가 이 값으로 말을 고른다.
 *
 * 🔴 파일에 feature 가 5개 있다고 5개가 그려지는 게 아니다 — `GridMap` 이 면이 아닌
 *    geometry 는 안 그린다. 여기서 따로 세면 「실제 형상」이라고 적어놓고 격자가
 *    그려지는 상태가 만들어진다. 그래서 **그리는 쪽 판정 함수를 그대로 부른다.**
 */
function drawableLayers(doc: ExclusionDoc | null): number {
  if (!doc) return 0;
  return doc.features.reduce((n, f) => n + (polygonsOf(f.geometry) ? 1 : 0), 0);
}

export default function Screen4Page() {
  const router = useRouter();
  const { run } = useRun();
  const grid = useArtifact<ScoreGridDoc>("score_grid", loadScoreGrid);
  const topn = useArtifact<TopNCsvRow[]>("topN", loadTopN);
  const report = useArtifact<ReportDoc>("report", loadReport);
  /**
   * 지역 이름(「용산구」) **하나 때문에** 받는다. 커버율을 「용산구 수요의 3.94%」로
   * 적으려면 분모가 무엇인지 알아야 하는데, `report.json` 에는 `domain`·`facility`
   * 뿐이고 `region` 이 없다(실측).
   *
   * 🔴 `run.domain` 으로 대신하면 안 된다 — 그건 저장 폴더 이름(`EV 충전소_2`)이라
   *    시설이지 지역이 아니다.
   * ⚠ 이 산출물이 없는 run 이면 `unavailable` 이고 `data` 가 `null` 이다. 그때는
   *    화면이 「전체 수요」로 떨어진다 — 실패해도 이 화면은 안 깨진다.
   */
  const weightSet = useArtifact<WeightSetDoc>("weight_set", loadWeightSet);
  /**
   * 배제 구역의 **실제 형상**. 없으면 `null` 이고 지도는 격자 사각형으로 떨어진다 —
   * 그 사실을 **안내 패널**이 말한다(아래 `showInfo` 블록). 조용히 바뀌지 않는다.
   *
   * 🔴 예전엔 지도 아래 `Legend` 가 이 말을 했는데 그 범례가 없어졌다. 빨간 면이
   *    「산출물 형상」인지 「격자 근사」인지는 **같은 그림이 아니다** — 뭉뚱그리면
   *    격자 계단을 실제 경계로 읽는다(원칙 4). 범례를 되살리는 대신 문장만 옮겼다.
   */
  const exclusion = useArtifact<ExclusionDoc>("exclusion", loadExclusion);

  const [selected, setSelected] = useState<number | null>(null);
  const [tileFailed, setTileFailed] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  /**
   * DEMO: 녹화에서 토론한 후보지(PNU). 그 필지만 고를 수 있다 — 다른 후보로
   * 화면 5 를 열면 토론 요청이 녹화와 달라 재생되지 않는다(`demo.ts`).
   * 고를 수 있는 게 하나뿐이라 들어오면 미리 골라 둔다.
   * `undefined` = 아직 읽는 중(그동안은 아무것도 못 고른다), `null` = 데모 아님/잠금 없음.
   */
  const [demoPnu, setDemoPnu] = useState<string | null | undefined>(DEMO ? undefined : null);
  useEffect(() => {
    if (!DEMO) return;
    void demoRecordedSite().then((s) => setDemoPnu(s?.pnu ?? null));
  }, []);
  const demoRank =
    demoPnu ? (topn.data?.find((r) => r.PNU === demoPnu)?.순위 ?? null) : null;
  const lockedOut = (rank: number) =>
    DEMO && (demoPnu === undefined || (demoPnu !== null && rank !== demoRank));

  const autoPicked = useRef(false);
  useEffect(() => {
    if (demoRank === null || autoPicked.current) return;
    autoPicked.current = true;
    setSelected(demoRank);
  }, [demoRank]);

  /**
   * 빈 지도를 눌러 선택을 지우면(`null`) 상세 팝업이 닫힙니다.
   */
  function select(rank: number | null) {
    if (rank !== null && lockedOut(rank)) return;
    setSelected(rank);
  }

  /**
   * 화면 5 로 넘긴다. **고른 위치를 같이 들고 간다.**
   *
   * 🔴 `rank == 1` 을 화면 5 가 알아서 쓰던 것을 여기서 끊는다 — 추천은 추천이고,
   *    어디로 공청회를 열지는 사람이 정한다(2026-08-10 사람 결정).
   *    이으는 키는 `PNU` 다. `순위` 는 실행마다 뜻이 달라 다른 필지를 가리킬 수 있다.
   *
   * 🔴 가는 곳은 `/hearing` 이 **아니라** `/hearing/select` 다(2026-08-11).
   *    화면 5 는 토론 방식이 둘이고(A 대립 `/hearing` · B 다인 `/dynamic-hearing`)
   *    엔진도 둘로 갈려 있다. 예전엔 여기서 A 를 **박아** 둬서 B 는 URL 을 직접
   *    쳐야 닿았다. 방식은 이 화면이 정하는 게 아니다 — 여기서 정하는 건 **어디를**
   *    이고, **어떻게**는 다음 화면에서 사람이 고른다.
   */
  function goHearing(row: TopNCsvRow) {
    writeSitePick({
      run_id: run?.run_id ?? null,
      rank: row.순위,
      pnu: row.PNU,
      jibun: row.JIBUN,
    });
    router.push("/hearing/select?force=true");
  }

  /**
   * 🔴 이 화면만 `PageBody` 를 안 쓴다. 그 통은 `max-w-[1200px]` 이고, 캔버스는
   *    1750px 이라 **550px 을 잘라 버린다**(실측: 지도가 922px). 지도가 있는 화면은
   *    여기 하나뿐이고, 넓이가 곧 읽히는 정보량이다.
   *
   * ⚠ 그렇다고 `PageBody` 에 `fullWidth` 를 되살리면 안 된다 — 그건 제목까지 같이
   *    끌고 나가서 단계를 넘길 때마다 제목이 400px 씩 튀었다(2026-08-15 지적).
   *    그래서 **제목만** 같은 통(`mx-auto max-w-[1200px] px-5`)에 그대로 두고
   *    지도 아래쪽만 폭을 푼다. 제목의 x 좌표는 나머지 다섯 화면과 글자 단위로 같다.
   *    ⓐ 바깥에 `px-5` 를 주면 안 된다 — 안쪽 통이 그만큼 좁아져 제목이 20px 밀린다.
   *    반드시 안쪽 통이 `px-5` 를 갖는다.
   */
  return (
    <div className="h-full flex flex-col min-h-0 pt-7 pb-5 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] shrink-0 px-5">
        <PageHeader
          screen={SCREEN}
          lead="선택된 후보지들이 얼마나 많은 수요를 감당할 수 있는지(커버율)를 확인합니다. 최종 순위는 단순 점수가 아닌 실질적인 수요 해결 기여도를 기준으로 결정됩니다."
        />
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-5 mt-4">
        <ArtifactView2 a={grid} b={topn} what="점수 격자와 후보지">
          {(g, rows) => {
            if (g.crs !== "EPSG:4326") {
              // 좌표계 추측은 이 프로젝트에서 실제로 사고가 났던 지점이다.
              // 다르면 그리지 않는다. 억지로 그리면 지도가 조용히 틀린다.
              return (
                <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-5 py-6 text-[13px] text-red-800">
                  <p className="font-medium">지도를 그리지 않았습니다.</p>
                  <p className="mt-1">
                    <code>score_grid.crs</code> 가 <code>{g.crs}</code> 입니다. 이 화면은
                    EPSG:4326(경위도)만 그립니다. 다른 좌표계를 경위도로 읽으면 마커가 조용히
                    엉뚱한 곳에 찍힙니다.
                  </p>
                </div>
              );
            }
            const sel = rows.find((r) => r.순위 === selected) ?? null;

            return (
              <>
                <section className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-hairline bg-white shadow-sm">
                  {/**
                    * 🔴 배경 타일이 안 떠도 **격자와 후보지는 정확하다.** 그 말을 안 하면
                    *    사용자는 「지도가 깨졌으니 결과도 못 믿는다」로 읽는다(원칙 4).
                    *    `onTileError` 가 상태를 세우기만 하고 화면에 아무것도 안 나오면
                    *    그건 조용한 실패다(원칙 1).
                    * ⚠ 예전엔 `basemap && tileFailed` 였는데 배경 지도 토글이 없어져
                    *    `basemap` 이 상수 `true` 다 — 조건에서 뺐다. 「토글을 꺼도 된다」는
                    *    안내도 같이 지웠다(끌 자리가 없다).
                    */}


                  {/**
                    * 🔴 `grid-cols-5` 였다. 비율 분할이라 통이 넓어지면 **오른쪽 패널도
                    *    같이 넓어져** 늘어난 폭의 1/5 를 리포트가 가져간다. 리포트는
                    *    글자 폭이 정해진 표라 넓어져 봐야 빈칸이 늘 뿐이다. 고정폭으로
                    *    묶고 남는 건 전부 지도에 준다.
                    */}
                  <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                    {/* Left: Map (남는 폭 전부) */}
                    <div className="relative h-full min-h-0 flex-1 min-w-0 border-r border-hairline overscroll-none touch-none">
                      <GridMap
                        grid={g}
                        topn={rows}
                        exclusion={exclusion.data}
                        selected={selected}
                        onSelect={select}
                        showExcluded={true}
                        showGrid={true}
                        basemap={true}
                        onTileError={() => setTileFailed(true)}
                      />
                      
                      {/* Floating Detail Popup */}
                      {sel && (
                        <div className="absolute top-4 left-4 z-10 w-[27rem] max-h-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-white/95 backdrop-blur shadow-2xl border border-gray-200 p-4">
                          <Detail
                            row={sel}
                            prev={rows.find((r) => r.순위 === sel.순위 - 1) ?? null}
                            rows={rows}
                            region={weightSet.data?.region ?? null}
                            onClose={() => select(null)}
                          />
                        </div>
                      )}
                      
                      {/* Floating Action Button */}
                      {/**
                       * 🔴 **고르기 전에는 못 넘어간다.** 이 `disabled` 는 꾸밈이 아니라
                       *    방어다 — 안 고르고 넘어가면 화면 5 가 스스로 1순위를 집게
                       *    되고, 그건 추천을 결정으로 바꿔 읽는 것이다(위 `goHearing`).
                       */}
                      <div className="absolute bottom-6 right-6 z-10">
                        <button
                          type="button"
                          disabled={!sel}
                          onClick={() => sel && goHearing(sel)}
                          className={`inline-flex items-center gap-2 rounded-xl px-8 py-4 text-[15px] font-bold shadow-xl transition-all ${
                            sel
                              ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                              : "cursor-not-allowed bg-white/90 text-gray-400 backdrop-blur border border-gray-200"
                          }`}
                        >
                          {sel ? "이 위치로 갈등 예측 실행" : "후보지를 먼저 선택하세요"}
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                        </button>
                      </div>
                    </div>

                    {/* Right: Sidebar (고정 320px) */}
                    <aside className="flex h-full flex-col min-h-0 bg-gray-50/80 backdrop-blur-xl border-l border-gray-200 md:w-[320px] md:shrink-0 relative">
                      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white/50 shrink-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-bold text-gray-800">최적 입지 분석 리포트</h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowInfo(!showInfo)}
                          className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${showInfo ? "bg-gray-300 text-gray-700" : "bg-gray-200 text-gray-500 hover:bg-gray-300"}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>
                        </button>
                      </div>

                      {/* Info Panel Dropdown */}
                      {showInfo && (
                        <div className="absolute top-[60px] right-4 w-72 z-20 p-4 rounded-xl bg-white/95 backdrop-blur shadow-xl border border-gray-200 text-[11px] leading-relaxed text-ink-secondary flex flex-col gap-2 animate-in fade-in slide-in-from-top-2">
                          <p><strong>내접폭</strong>은 이 필지 안에 시설이 실제로 들어가는지를 보는 값입니다. 면적이 넓어도 길쭉하면 못 놓습니다.</p>
                          <p><strong>커버 기여</strong>는 비율이 아니라 수요값 절대량입니다(산출물 그대로). 커버율이 실제로 얼마나 올랐는지는 「실질 커버율 상승폭」으로 보십시오.</p>
                          <p><strong>인접한 타 추천 후보지</strong>는 산출물에 없는 값이라 Top-N 좌표로 이 화면에서 계산한 것입니다. 실제 이격이 기준보다 큰지 확인하는 용도입니다.</p>
                          {/* 🔴 빨간 면이 **무엇인지**를 적는다. 산출물 형상일 때와 격자로 대신
                              그릴 때는 같은 그림이 아니다 — 뭉뚱그리면 격자 계단을 실제 경계로 읽는다. */}
                          <p>
                            <strong>설치 불가 지역</strong>(빨간 면)은{" "}
                            {drawableLayers(exclusion.data) > 0
                              ? `배제 ${drawableLayers(exclusion.data)}종의 실제 형상입니다.`
                              : `산출물에 형상이 없어 ${g.spacing_m}m 격자로 근사한 것입니다 — 계단 모양 경계를 실제 경계로 읽지 마십시오.`}
                          </p>
                        </div>
                      )}

                      <div className="min-h-0 flex-1 custom-scrollbar overflow-y-auto p-4 flex flex-col gap-6">
                        <Coverage report={report.data} nTop={rows.length} />
                        <TopList rows={rows} selected={selected} onSelect={select} lockedOut={lockedOut} />
                      </div>
                    </aside>
                  </div>

                </section>
              </>
            );
          }}
        </ArtifactView2>
      </div>
    </div>
  );
}



function Coverage({ report, nTop }: { report: ReportDoc | null; nTop: number }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!report) return null;
  const cov = report.coverage;
  if (!cov) return null;
  
  const atTop = cov.cumulative[nTop - 1] ?? null;
  const reach = Object.entries(cov.reach).sort((a, b) => Number(a[0]) - Number(b[0]));

  return (
    <section className="flex flex-col gap-4 shrink-0 border-b border-gray-200 pb-4">
      {/* Top: Big Number & Chart */}
      <div className="flex flex-col gap-3">
        <div className="text-center">
          <div className="text-[12px] text-ink-secondary mb-1">상위 {nTop}곳 설치 시 커버율</div>
          <div className="tnum text-[32px] font-black text-blue-600 leading-none">{percent(atTop, 1)}</div>
        </div>
      </div>

      <button 
        type="button" 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full text-[12px] font-semibold text-gray-600 bg-gray-100/50 hover:bg-gray-100 px-3 py-2 rounded-lg transition-colors"
      >
        <span>상세 통계 지표 보기</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>

      {/* Bottom: Stats */}
      {isOpen && (
        <div className="flex flex-col animate-in slide-in-from-top-2 fade-in duration-200">
          <dl className="flex flex-col gap-y-2 text-[12px]">
            {reach.map(([target, n]) => (
              <div key={target} className="flex justify-between gap-3 border-b border-gray-200/50 pb-1">
                <dt className="text-ink-secondary">전체 수요의 {percent(Number(target), 0)} 해결</dt>
                <dd className="tnum font-bold text-gray-800">{int(n)}곳 필요</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-b border-gray-200/50 pb-1 mt-2">
              <dt className="text-ink-secondary" title="더 이상 후보지를 늘려도 커버율이 크게 오르지 않는 효율성 한계점입니다.">효율성 감소 시작점 (가성비 한계)</dt>
              <dd className="tnum font-bold text-gray-800">{int(cov.knee)}곳</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-gray-200/50 pb-1">
              <dt className="text-ink-secondary" title={`물리적으로 도달 불가능한 수요점: ${int(cov.unreached_n)}개`}>최대 커버율 한계</dt>
              <dd className="tnum font-bold text-gray-800">{percent(cov.ceiling, 2)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

/** 커버 곡선. 라이브러리 없이 SVG polyline 하나면 된다. */
function CoverageChart({
  cumulative,
  knee,
  nTop,
}: {
  cumulative: number[];
  knee: number;
  nTop: number;
}) {
  if (cumulative.length < 2) return null;
  const W = 320;
  const H = 90;
  const n = cumulative.length;
  const max = Math.max(...cumulative, 1e-9);
  const pts = cumulative
    .map((v, i) => `${(i / (n - 1)) * W},${H - (v / max) * H}`)
    .join(" ");
  const xAt = (i: number) => ((i - 1) / (n - 1)) * W;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none" role="img" aria-label="커버율 곡선">
      <polyline points={pts} fill="none" stroke="#0075de" strokeWidth={2} />
      {knee >= 1 && knee <= n && (
        <line x1={xAt(knee)} y1={0} x2={xAt(knee)} y2={H} stroke="#c0392b" strokeWidth={1} strokeDasharray="3 3" />
      )}
      {nTop >= 1 && nTop <= n && (
        <line x1={xAt(nTop)} y1={0} x2={xAt(nTop)} y2={H} stroke="#191919" strokeWidth={1} strokeDasharray="2 2" />
      )}
    </svg>
  );
}

function TopList({
  rows,
  selected,
  onSelect,
  lockedOut,
}: {
  rows: TopNCsvRow[];
  selected: number | null;
  onSelect: (rank: number) => void;
  /** DEMO 에서 고를 수 없는 행(녹화한 후보가 아니다). 데모가 아니면 항상 `false`. */
  lockedOut: (rank: number) => boolean;
}) {
  const [showRankInfo, setShowRankInfo] = useState(false);
  const sorted = [...rows].sort((a, b) => a.순위 - b.순위);
  /* 탭 안이라 카드 테두리를 두르지 않는다 — 탭 머리가 이미 경계다. 겹치면
     상자 안의 상자가 되어 어디까지가 한 덩어리인지 흐려진다. */
  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-bold text-gray-800">최적 입지 추천 순위</h3>
        <button
          type="button"
          onMouseEnter={() => setShowRankInfo(true)}
          onMouseLeave={() => setShowRankInfo(false)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>
        </button>
      </div>
      
      {showRankInfo && (
        <div className="absolute right-0 top-6 z-20 w-64 p-3 rounded-lg bg-gray-800 text-white text-[11px] leading-relaxed shadow-lg animate-in fade-in zoom-in-95">
          최종 순위는 <b>실질적인 수요 해결 기여도</b>에 따라 결정됩니다. (단순 점수가 높아도 주변에 다른 우수 후보지가 있어 상권이 겹치면 순위가 밀릴 수 있습니다.)
        </div>
      )}

      {/* 헤더 행 */}
      <div className="flex w-full items-center gap-2 px-2 pb-1 text-[11px] font-semibold text-ink-secondary border-b border-gray-200/50">
        <span className="w-6 shrink-0 text-center">순위</span>
        <span className="flex-1">지번 주소</span>
        <span className="w-16 shrink-0 text-right">점수</span>
        <span className="w-16 shrink-0 text-right">누적커버율</span>
      </div>

      <ul className="mt-1 flex flex-col gap-1">
        {sorted.map((r) => {
          const on = r.순위 === selected;
          const locked = lockedOut(r.순위);
          return (
            <li key={r.순위}>
              <button
                type="button"
                onClick={() => onSelect(r.순위)}
                disabled={locked}
                title={locked ? "데모는 기록된 실행에서 토론한 후보만 고를 수 있습니다" : undefined}
                aria-current={on ? "true" : undefined}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-black/[0.04] disabled:hover:bg-transparent"
                }`}
              >
                <span className="tnum w-6 shrink-0 text-[12px] font-semibold text-primary">
                  {r.순위}
                </span>
                <span className="flex-1 truncate text-[12px]">{r.JIBUN}</span>
                <span className="tnum w-16 shrink-0 text-right text-[11px] text-ink-secondary">{`${fixed(r.점수 * 100, 1)}점`}</span>
                <span className="tnum w-16 shrink-0 text-right text-[11px] text-ink-secondary">
                  {percent(r.누적커버율, 1)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 선택한 후보에서 **가장 가까운 다른 후보**까지의 거리(m).
 *
 * 🔴 산출물에는 이 값이 없다. 행 단위 「최소 이격」 열이 topN_min.csv 에 없어서
 *    좌표로 화면에서 계산한다 — 격자 사각형을 중심점 + `spacing_m` 으로 만드는
 *    것과 같은 성격이다(있는 값에서 결정론적으로 유도). 지어낸 값이 아니므로
 *    화면에도 "화면에서 계산" 이라고 적는다(절대원칙 4).
 *
 * 하버사인을 쓴다. 용산구 범위(수 km)에서 타원체 오차는 0.5% 미만이라
 * 이격 판정(수백 m 대 200m)에 영향이 없다. 정밀 거리가 필요해지면 그건
 * 화면이 아니라 백엔드가 5186 평면에서 내야 할 값이다.
 */
function nearestOther(
  row: TopNCsvRow,
  rows: TopNCsvRow[],
): { rank: number; m: number } | null {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  let best: { rank: number; m: number } | null = null;
  for (const o of rows) {
    if (o.순위 === row.순위) continue;
    const la1 = rad(row.위도);
    const la2 = rad(o.위도);
    const h =
      Math.sin((la2 - la1) / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(rad(o.경도 - row.경도) / 2) ** 2;
    const m = 2 * R * Math.asin(Math.sqrt(h));
    if (!best || m < best.m) best = { rank: o.순위, m };
  }
  return best;
}

/**
 * 🔴 `커버기여` 는 **비율이 아니다.** 처음에 `percent()` 로 찍었더니 4순위가
 *    "6142.57%" 로 나왔다 — 숫자만 봐도 말이 안 되는데, 만약 값이 0.6 대였다면
 *    "60%" 로 그럴듯하게 보여서 아무도 못 잡았을 것이다.
 *
 *    실측으로 정체를 확인했다: `topn[i].커버기여` ≡ `report.coverage.marginal[i]`
 *    (70.0307 · 66.2182 · 62.0606 · 61.4257 …). **수요값 절대량**이다.
 *    총 수요값은 어느 산출물에도 없어서(누적커버율에서 역산은 되지만 그건 추정이다)
 *    분모 없이 절대값 그대로 보여주고, 사람이 실제로 알고 싶은 "이 한 곳이 커버율을
 *    얼마나 올렸나" 는 **비율인 `누적커버율` 의 차분**으로 따로 계산해 붙인다.
 */
function Detail({
  row,
  prev,
  rows,
  region,
  onClose,
}: {
  row: TopNCsvRow;
  /** 직전 순위. 1순위면 null — 그때 증가분은 0 에서 올라온 값이다. */
  prev: TopNCsvRow | null;
  /** 이격 계산에 필요하다 — 거리는 한 행만 봐서는 나오지 않는다. */
  rows: TopNCsvRow[];
  /**
   * 분석 지역 이름("용산구"). 커버율이 **무엇에 대한 비율인지** 적기 위한 것이다.
   *
   * 🔴 산출물에서 못 읽으면 `null` 이고, 그때는 「전체 수요」라고만 적는다.
   *    "용산구" 를 기본값으로 박으면 다른 지역 run 에서 조용히 거짓말을 한다.
   */
  region: string | null;
  onClose: () => void;
}) {
  const deltaCover = row.누적커버율 - (prev?.누적커버율 ?? 0);
  const near = nearestOther(row, rows);
  /**
   * 「용산구 수요」 · 지역을 모르면 「전체 수요」.
   *
   * ⚠ 산출물의 `region` 은 **"서울특별시 용산구"** 로 온다(실측 `r_20260824_002`).
   *   그대로 쓰면 한 줄이 표를 넘겨서 마지막 마디만 쓴다. **줄인 이름은 여기서만**이고,
   *   원문은 툴팁에 그대로 싣는다 — 「중구」처럼 여러 시에 있는 이름일 때 어느 중구인지
   *   화면에서 사라지면 안 된다(원칙 4).
   */
  const short = region ? (region.split(/\s+/).pop() ?? region) : null;
  const demandOf = short ? `${short} 수요` : "전체 수요";
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] text-ink-secondary">{row.순위}순위 후보지</div>
          <h2 className="text-[17px] font-semibold">{row.JIBUN}</h2>
        </div>
        {/* 「목록으로」가 아니라 「선택 해제」다. 목록은 탭으로 늘 있으므로 이 버튼이
            하는 일은 **고른 것을 지우는 것**(지도 강조도 같이 풀린다)이다. */}
        <button type="button" onClick={onClose} className="btn-secondary shrink-0 text-[12px]">
          선택 해제
        </button>
      </div>

      {/**
        * 🔴 **네 줄을 지웠다**(2026-08-24 사용자 지적: 「정보가 너무 많아」).
        *    부지 면적 · 시설 간 최소 설치 간격 · 국유재산 지번 일치 · 후보 위치
        *    생성 방식. 넷 다 **파이프라인이 이미 판정에 쓰고 거른** 값이라, 여기서
        *    다시 보여줘도 사람이 그걸로 뒤집을 게 없다. 남긴 것은 「어디를 고를까」에
        *    실제로 쓰이는 것들뿐이다.
        *    ⚠ 되살릴 거면 접이식으로. 이 팝업은 지도 위에 떠 있어서 길어질수록
        *      정작 봐야 할 지도를 가린다.
        */}
      <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
        <Row
          k="수요 해결 기여 점수"
          v={`${fixed(row.커버기여, 1)}`}
          bold
          hint={
            "이 곳을 설치했을 때 「새로」 감당하게 되는 수요의 양입니다.\n" +
            "앞순위가 이미 커버한 수요는 빼고 셉니다 — 그래서 순위가 내려갈수록 작아집니다.\n" +
            "최종 순위는 「입지 평가 점수」가 아니라 이 값으로 정합니다.\n" +
            "출처: report.json 의 coverage.marginal (비율이 아니라 절대량이라 % 가 아닙니다)"
          }
        />
        <Row
          k="입지 평가 점수"
          v={`${fixed(row.점수 * 100, 1)}`}
          hint={
            "화면 3 에서 확정한 지표별 가중치로 이 지점 「하나만」 채점한 값입니다 (0~100).\n" +
            "이미 뽑힌 후보와 수요가 겹치는지는 안 봅니다 — 그래서 이 점수가 높아도 최종 순위는 낮을 수 있고, 반대도 됩니다.\n" +
            "출처: topN.csv 의 점수 × 100"
          }
        />
        {/**
          * 🔴 예전 이름은 「추가 수요 커버 +3.94%p」였다. **무엇의 3.94% 인지 화면에
          *    없었다** — 사람은 「이 자리 하나가 3.94% 를 커버한다」로 읽는데, 실제로는
          *    앞순위가 덮은 수요를 뺀 **순증분**이라 단독 설치하면 이보다 크다.
          *    분모(지역)와 「새로」를 문장에 넣어 그 오해를 막는다(원칙 4).
          */}
        <Row
          k="이 곳이 새로 커버하는 수요"
          v={`${demandOf}의 ${fixed(deltaCover * 100, 2)}%`}
          hint={
            `이 곳을 추가로 설치하면 ${demandOf} 중 ${fixed(deltaCover * 100, 2)}% 를 새로 감당하게 됩니다.\n` +
            (row.순위 === 1
              ? "1순위라 앞에 뺄 것이 없습니다 — 이 곳 단독 커버율과 같습니다.\n"
              : `1~${row.순위 - 1}순위가 이미 커버한 수요는 빼고 센 값입니다. 이 곳만 단독으로 설치하면 이보다 큽니다.\n`) +
            (region ? `분석 지역 전체 이름: ${region}` : "분석 지역 이름을 산출물에서 못 읽어 「전체 수요」로 적었습니다.")
          }
        />
        {/* 1순위면 누적 = 순증이라 같은 숫자가 두 번 나온다(그리고 「1~1순위」라고 적힌다). 안 그린다. */}
        {row.순위 > 1 && (
          <Row
            k={`1~${row.순위}순위 누적`}
            v={`${demandOf}의 ${percent(row.누적커버율, 2)}`}
          />
        )}
        {/* 지목 부호 → 정식 명칭. 예전엔 여기서 「대」만 손으로 풀었는데, 부호는
            28 종이라 나머지는 한 글자 그대로 나왔다. 표는 `jimokLabel` 로 통일한다. */}
        <Row k="토지 유형" v={jimokLabel(row.지목)} />
        <Row k="실제 설치 가능 폭" v={`${fixed(row.내접폭, 1)}m`} />
        <Row
          k="가장 가까운 다른 추천 후보"
          v={near === null ? "주변에 후보지 없음" : `${fixed(near.m, 0)}m · 추천 ${near.rank}순위`}
        />
        <Row k="국가 소유 지분" v={row.국유_지분율 === 0 ? "없음" : percent(row.국유_지분율, 1)} />
        <Row k="필지 고유번호(PNU)" v={row.PNU} mono />
        <Row k="위치 좌표" v={`${row.위도.toFixed(6)}, ${row.경도.toFixed(6)}`} mono />
      </dl>

    </div>
  );
}

/**
 * @param hint 마우스를 올리면 뜨는 **산정 방식** 설명. 여러 줄이면 `\n` 으로 나눈다.
 *
 * 🔴 설명이 있는 줄에는 **점선 밑줄과 `cursor-help` 를 같이 준다.** 아무 표시 없이
 *    `title` 만 달면 거기에 설명이 있다는 걸 아무도 모른다 — 안 단 것과 같다.
 *
 * ⚠ 브라우저 기본 툴팁이다. 직접 만든 말풍선이 아닌 이유: 이 팝업은 지도 위에
 *   `overflow-y-auto` 통 안에 떠 있어서, 안에서 절대배치한 말풍선은 통에 잘린다.
 *   기본 툴팁은 브라우저가 창 기준으로 띄워 안 잘린다. 대신 뜨는 데 1초쯤 걸리고
 *   모바일에선 안 뜬다 — 그래서 **점수 값 자체는 툴팁 없이도 읽히게** 두었다.
 */
function Row({
  k,
  v,
  mono,
  bold,
  hint,
}: {
  k: string;
  v: string;
  mono?: boolean;
  bold?: boolean;
  hint?: string;
}) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "mb-1" : ""}`}>
      <dt
        title={hint}
        className={`shrink-0 ${bold ? "font-bold text-gray-900 text-[15px]" : "text-ink-secondary"} ${
          hint ? "cursor-help underline decoration-dotted decoration-gray-400 underline-offset-4" : ""
        }`}
      >
        {k}
      </dt>
      <dd className={`text-right ${bold ? "font-bold text-blue-600 text-[17px]" : "font-medium"} ${mono && !bold ? "tnum text-[12px]" : "tnum"}`}>{v}</dd>
    </div>
  );
}


