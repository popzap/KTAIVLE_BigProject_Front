"use client";

/**
 * 화면 6 · 기획안
 * ===============
 * 명세: 「결정을 남긴다. 근거와 **하지 않은 것**까지 같이 남긴다.」
 *
 * 🔴 **공문서가 아니라 기획안이다.** 병합으로 들어온 `/hearing-pdf` 표본은
 *    결재선(담당자 홍길동·팀장 김철수·과장 이영희) · 시행번호(입지심의과-2026호) ·
 *    발신명의(스마트시티 입지심의위원장) · 주소(우 03187 …) · 연락처(02-123-4567)를
 *    **코드에 박고** 있었다. 그건 실행 결과가 아니라 지어낸 값이고, 문서 모양이
 *    갖춰질수록 읽는 사람은 실제 결재를 거친 것으로 읽는다(원칙 2·4).
 *    여기서는 **하나도 옮겨오지 않았다.** 결재·시행 정보는 사람이 정하는 것이고
 *    우리 산출물에 없다 — 없는 것은 비워 두는 게 아니라 **칸 자체를 안 만든다.**
 *
 * 가져온 것은 **양식과 QR** 뿐이다: A4 폭 문서 컨테이너 · 인쇄 스타일 ·
 * 지도 QR(카카오·네이버). QR 값도 표본 좌표가 아니라 **화면 4 에서 고른 후보의
 * 실제 지번·경위도**로 만든다.
 *
 * 읽는 것 (전부 실행 산출물이다)
 *   reviewed.json     감리 결과   — 시설·지역 확정, 역할 판정, 배제 규칙, 확인 요청
 *   clean_report.json 정제 결과   — 데이터셋별 원본→정제 행수, 이상치
 *   report.json       본문 대부분 — weight_set · counts · spatial · coverage · data_gap
 *   topN.csv          위치 선정   — 좌표는 여기에만 있다
 *   /simulations/hearings  토론 결과 — 이 실행에서 열린 공청회(서버 DB)
 *   sessionStorage    토론 결과   — 위에 못 물었을 때만. A(`sim_*`) · B(`omnisite.hearingB.v1`)
 *
 * 🔴 토론 결과만 파일 산출물이 아니다. 2026-08-11 부터 **서버 DB 에 남으므로 거기가
 *    본선**이고(`hearings.ts`), 탭 기록은 서버에 못 물었을 때(적재 칸 없는
 *    fixture·hitl 실행 · 404 · 네트워크 실패) 쓰는 폴백이다. 어느 쪽에서 읽었는지는
 *    8절이 문서에 적는다. **없으면 없다고 적는다** — 표본 시나리오를 채워 넣지 않는다.
 *
 * 🔴 `data_gap` 은 부록이 아니라 핵심이다. 적용 안 한 것을 "안 했다"고 적는 것이
 *    산출물 계약이다(원칙 4). 그래서 개요에도 건수를 띄운다.
 *
 * 🔴 화면 2 의 확인 요청(`reviewed.hitl_flags`)과 `data_gap` 을 **섞지 않는다.**
 *    저기는 감리 단계, 여기는 실행이 끝난 뒤 엔진이 남긴 것이다.
 *
 * 내보내기는 `window.print()` 다. `jspdf` 가 설치돼 있지만 쓰지 않았다 —
 * 캔버스로 그린 PDF 는 글자가 이미지가 되고 한글 폰트를 따로 실어야 한다.
 *
 * ⚠ 이 배치는 **임시**다. 최종 PDF 세부 양식은 동현님 작업분이다.
 */
import { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, Printer } from "lucide-react";

import { ArtifactView2 } from "@/components/ui/ArtifactView";
import { PageBody, PageHeader, SourceNote } from "@/components/ui/Page";
import { useArtifact } from "@/lib/omnisite/useArtifact";
import { useRun } from "@/lib/omnisite/RunProvider";
import {
  loadCleanReport,
  loadReport,
  loadReviewed,
  loadTopN,
  MODE_FULL,
  TOPN_MAX,
} from "@/lib/omnisite/pipeline";
import { areaM2, datetime, fixed, int, km2, percent } from "@/lib/omnisite/format";
import { jimokLabel, jimokText } from "@/lib/omnisite/jimok";
import { SCREENS } from "@/lib/omnisite/screens";
import { readSitePick, type SitePick } from "@/lib/omnisite/sitePick";
import { useHydrated } from "@/lib/omnisite/useHydrated";
import {
  readHearingA,
  readHearingB,
  type HearingLine,
  type HearingResultA,
  type HearingResultB,
} from "@/lib/omnisite/hearingResult";
import {
  useRunHearingDetails,
  type RunHearingDetails,
  type ServerHearingA,
  type ServerHearingB,
} from "@/lib/omnisite/hearings";
import type {
  CleanReportDoc,
  DataGap,
  ReportDoc,
  ReviewedDoc,
  RunDoc,
  TopNCsvRow,
} from "@/lib/omnisite/types";

const SCREEN = SCREENS.find((s) => s.no === "6")!;

const SECTIONS = [
  ["s1", "1. 개요"],
  ["s2", "2. 감리 결과"],
  ["s3", "3. 정제 결과"],
  ["s4", "4. 배제 구역"],
  ["s5", "5. 가중치"],
  ["s6", "6. 위치 선정 결과"],
  ["s7", "7. 커버율"],
  ["s8", "8. 공청회 토론 결과"],
  ["s9", "9. 개선 방법"],
] as const;


/**
 * 발언 기록을 문서 본문에 몇 건까지 그대로 실을지.
 *
 * 🔴 **넘치는 분량을 요약하지 않는다.** 요약은 무엇이 중요했는지를 고르는 일이고,
 *    그건 이 화면이 할 수 있는 판단이 아니다 — 여기서 만들면 **산출물에 없던 결론**이
 *    기획안의 근거로 올라간다(원칙 4·5). 대신 **앞뒤를 잘라 발췌**로 싣고,
 *    가운데 몇 건을 뺐는지 숫자로 적고, **전문은 JSON 으로 내려받게** 한다.
 *    「요약」이라고 적으면 읽는 사람은 뺀 부분이 안 중요했다고 읽는다.
 *
 * 문서에 남는 「토론 결과」는 엔진이 낸 값이다 — B 는 `status.report`(최종 시나리오
 * 원문. 2026-08-11 전 기록은 `status.reporter`), A 는 갈등 등급·수용도.
 * 그건 우리가 만든 게 아니라 받은 값이라 그대로 싣는다.
 */
const TRANSCRIPT_INLINE_MAX = 12;
const TRANSCRIPT_HEAD = 5;
const TRANSCRIPT_TAIL = 5;

/**
 * 인쇄 스타일.
 *
 * 앱 골격이 `body { height:100%; overflow:hidden }` 에 좌우 분할이라, 그대로
 * 인쇄하면 **첫 화면만** 나온다. 그래서 인쇄일 때만 흐름을 되돌린다.
 * `header`·`footer`·`aside` 는 레이아웃(`app/layout.tsx`)이 그리는 앱 크롬이라
 * 이 파일에서 클래스를 붙일 수 없어 **요소 선택자**로 숨긴다.
 * `.fixed` 는 사이드바가 접혔을 때 남는 토글 버튼이다(Tailwind 클래스가 그대로
 * DOM 에 있어 선택자가 된다).
 */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  html, body {
    height: auto !important;
    overflow: visible !important;
    background: #fff !important;
  }
  body > div, main, .doc-flow {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
  }
  header, footer, aside, .fixed, .doc-hide { display: none !important; }
  .doc-section { break-inside: avoid; }
}
`;

/** sessionStorage 에서 오는 값들. `null` = 아직 안 읽음(하이드레이션 전). */
interface SessionSide {
  pick: SitePick | null;
  a: HearingResultA | null;
  b: HearingResultB | null;
}

export default function Screen6Page() {
  const { run } = useRun();
  const report = useArtifact<ReportDoc>("report", loadReport);
  const topn = useArtifact<TopNCsvRow[]>("topN", loadTopN);
  const clean = useArtifact<CleanReportDoc>("clean_report", loadCleanReport);
  const reviewed = useArtifact<ReviewedDoc>("reviewed", loadReviewed);

  /**
   * 🔴 렌더 중에 `sessionStorage` 를 읽지 않는다 — 서버 프리렌더엔 없어서 하이드레이션
   *    첫 판에 읽으면 서버가 그린 것과 달라진다. 예전엔 마운트 `useEffect` 에서
   *    `setSide(...)` 로 했는데 그건 **effect 안의 동기 setState** 라
   *    `react-hooks/set-state-in-effect` 가 잡는다. 지금은 값이 아니라 **시점**만
   *    구독하고(`useHydrated`) 읽기는 렌더 중에 한다.
   *
   *    셋을 **한 판정으로** 묶는 이유는 그대로다: 따로 두면 첫 프레임에
   *    「토론 없음」·「위치 없음」이 각각 한 번씩 깜빡인다. `useHydrated` 는 셋이
   *    같은 순간에 뒤집히는 걸 보장한다 — 옛 `side !== null` 과 뜻이 같다.
   *
   *    `pick` 만 `sitePick.ts` 로 값 구독을 할 수도 있지만 안 한다. 화면 6 은 읽기
   *    전용 문서라 머무는 동안 값이 바뀌지 않고, 한쪽만 구독하면 위의 「한 판정」이
   *    깨진다.
   */
  const hydrated = useHydrated();
  const side: SessionSide | null = hydrated
    ? { pick: readSitePick(), a: readHearingA(), b: readHearingB() }
    : null;

  /**
   * 🔴 **토론 결과의 본선은 서버다**(2026-08-11 경로가 열렸다). 위 `side` 는 이제
   *    서버에 **못 물었을 때**(적재 칸 없는 fixture·hitl 실행 · 404 · 네트워크 실패)
   *    쓰는 폴백이고, 그 사실을 8절이 문서에 적는다.
   */
  const served = useRunHearingDetails();

  return (
    <PageBody>
      <div className="doc-hide">
        <PageHeader
          screen={SCREEN}
          right={
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-secondary flex items-center gap-1.5 text-[12px]"
            >
              <Printer size={14} />
              인쇄 · PDF 저장
            </button>
          }
        />
      </div>

      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="doc-flow mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4 pr-2">
        <ArtifactView2 a={report} b={topn} what="기획안">
          {(rep, rows) => (
            <div className="mx-auto w-full max-w-[860px] rounded-2xl border border-hairline bg-white p-8 shadow-sm print:max-w-full print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-12">
              <DocHead
                rep={rep}
                reviewed={reviewed.data}
                clean={clean.data}
                runId={run?.run_id ?? null}
                finished={run?.finished_at ?? null}
              />

              <nav className="doc-hide mt-6 flex flex-wrap gap-x-3 gap-y-1.5 rounded-lg border border-hairline bg-black/[0.02] px-4 py-3 text-[12px]">
                <span className="text-ink-secondary">목차</span>
                {SECTIONS.map(([id, label]) => (
                  <a key={id} href={`#${id}`} className="text-primary hover:underline">
                    {label}
                  </a>
                ))}
              </nav>

              <Overview rep={rep} />
              <AuditSection doc={reviewed.data} />
              <CleanSection clean={clean.data} rep={rep} />
              <ExclusionSection rep={rep} />
              <WeightSection rep={rep} />
              <SiteSection rows={rows} pick={side?.pick ?? null} read={side !== null} />
              <CoverageSection rep={rep} />
              <HearingSection
                served={served}
                a={side?.a ?? null}
                b={side?.b ?? null}
                read={side !== null}
              />
              <GapSection gaps={rep.data_gap} run={run ?? null} />

              <p className="mt-10 border-t border-hairline pt-4 text-[11px] leading-relaxed text-ink-secondary">
                이 문서의 모든 수치는 위 실행(<span className="tnum">{run?.run_id ?? "—"}</span>)의
                산출물에서 그대로 읽은 값입니다. 결재·시행 정보는 산출물에 없으므로 문서에
                포함하지 않았습니다 — 심의 제출용 최종 양식은 별도로 확정됩니다.
              </p>
            </div>
          )}
        </ArtifactView2>
      </div>

      <div className="doc-hide">
      </div>
    </PageBody>
  );
}

// ── 표제부 ─────────────────────────────────────────────────────

function DocHead({
  rep,
  reviewed,
  clean,
  runId,
  finished,
}: {
  rep: ReportDoc;
  reviewed: ReviewedDoc | null;
  clean: CleanReportDoc | null;
  runId: string | null;
  finished: string | null;
}) {
  /**
   * 지역명은 **산출물에만 있다.** `reviewed.facility_inference.region` 이 STEP1
   * 확정값이고, `clean_report.region` 이 정제 단계가 쓴 값이다. 둘 다 없으면
   * 제목에서 **빼 버린다** — "서울특별시" 같은 걸 채우면 그건 지어낸 값이다.
   */
  const region = reviewed?.facility_inference?.region || clean?.region || "";
  const facility = rep.facility || reviewed?.facility_inference?.facility || "";
  const title = [region, facility].filter(Boolean).join(" ");

  return (
    <header className="border-b-2 border-ink/80 pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-semibold text-primary">
          기획안
        </span>

      </div>
      <h1 className="mt-3 text-center text-[26px] font-bold tracking-[0.2em]">
        {title ? `${title} 입지 선정 기획안` : "입지 선정 기획안"}
      </h1>
      <dl className="mt-5 grid gap-x-8 gap-y-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
        <Item k="도메인" v={rep.domain} />
        <Item k="대상 시설" v={facility || "—"} />
        <Item k="실행 id" v={runId ?? "—"} mono />
        <Item k="실행 완료" v={datetime(finished)} />
      </dl>
    </header>
  );
}

// ── 1. 개요 ────────────────────────────────────────────────────

function Overview({ rep }: { rep: ReportDoc }) {
  const params = Object.entries(rep.facility_params);
  return (
    <section className="doc-section">
      <H id="s1">1. 개요</H>
      <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <Item k="후보 필지" v={`${int(rep.counts.parcels)}필지`} />
        <Item k="후보점" v={`${int(rep.counts.points)}개`} />
        <Item k="배제 후 생존" v={`${int(rep.counts.survive)}개`} />
        <Item
          k="미확인 · 미적용"
          v={`${rep.data_gap.length}건`}
          tone={rep.data_gap.length > 0 ? "warn" : undefined}
        />
      </dl>

      {params.length > 0 && (
        <div className="mt-4 rounded-lg border border-hairline bg-black/[0.015] p-4">
          <h3 className="text-[13px] font-semibold">시설 파라미터</h3>
          <p className="mt-1 text-[11px] text-ink-secondary">
            법정값입니다 — 자리표시자가 아니라 실값을 씁니다.
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-[12px]">
            {params.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="text-ink-secondary">{k}</dt>
                <dd className="tnum font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

// ── 2. 감리 결과 ───────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  hard_exclusion: "배제",
  positive_factor: "가점",
  negative_factor: "감점",
  reference_only: "참고",
};

function AuditSection({ doc }: { doc: ReviewedDoc | null }) {
  if (!doc) {
    return (
      <section className="doc-section">
        <H id="s2">2. 감리 결과</H>
        <p className="mt-3 text-[13px] text-ink-secondary">
          <code>audit_result_reviewed.json</code> 을 아직 읽지 못했습니다. 감리 판정을
          지어내지 않습니다.
        </p>
      </section>
    );
  }

  const fi = doc.facility_inference;
  const roleCount = new Map<string, number>();
  const exclusions: { dataset: string; r: ReviewedDoc["results"][number]["roles"][number] }[] = [];
  let flagTotal = 0;
  let flagConfirmed = 0;

  for (const res of doc.results) {
    for (const r of res.roles) {
      roleCount.set(r.role, (roleCount.get(r.role) ?? 0) + 1);
      if (r.role === "hard_exclusion") exclusions.push({ dataset: res.dataset_id, r });
    }
    for (const f of res.hitl_flags) {
      flagTotal += 1;
      if (f.confirmed_by_human || f.confirmed) flagConfirmed += 1;
    }
  }

  return (
    <section className="doc-section">
      <H id="s2">2. 감리 결과</H>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
        데이터셋 {doc.results.length}종을 감리해 역할을 판정했습니다. 확인 요청{" "}
        {int(flagTotal)}건 중 {int(flagConfirmed)}건이 확정되었습니다.
      </p>

      <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <Item k="확정 시설" v={fi?.facility || "—"} />
        <Item k="확정 지역" v={fi?.region || "—"} />
        {[...roleCount.entries()].map(([role, n]) => (
          <Item key={role} k={ROLE_LABEL[role] ?? role} v={`${int(n)}건`} />
        ))}
      </dl>

      {fi?.근거 && (
        <p className="mt-3 rounded-lg border border-hairline bg-black/[0.015] px-4 py-3 text-[12px] leading-relaxed text-ink-secondary">
          <b className="text-ink">시설 · 지역 판정 근거</b> {fi.근거}
          {/* ⚠ 이 꼬리말이 한 번도 안 붙는 게 정상처럼 보일 수 있다 — 백엔드 별건이다.
              2026-08-24 실측: 데이터가 전부 흡연인데 입력만 EV 여도 `mismatch: false`
              였다(STEP0.5 프롬프트 쪽, 원인 미규명). 프런트 결함이 아니니 여기를
              고치려 들지 말 것. 화면1 이 보내는 조합 형식과도 무관하다 — 괄호든
              문장이든 같았다. 자세한 판단 근거는 `audit/page.tsx` 의 같은 자리 주석. */}
          {fi.mismatch && (
            <>
              {" "}
              <b className="text-amber-700">
                — 입력과 어긋남: {fi.mismatch_reason || "사유 없음"}
              </b>
            </>
          )}
        </p>
      )}

      {exclusions.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-hairline">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-hairline bg-black/[0.02] text-left text-ink-secondary">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">배제 대상</th>
                <th className="px-3 py-2 font-medium">판정</th>
                <th className="px-3 py-2 text-right font-medium">배제 반경</th>
                <th className="px-3 py-2 font-medium">확정</th>
              </tr>
            </thead>
            <tbody>
              {exclusions.map(({ dataset, r }, i) => (
                <tr key={`${dataset}-${i}`} className="border-b border-hairline last:border-0">
                  <td className="tnum px-3 py-2 font-medium">{dataset}</td>
                  <td className="px-3 py-2">{r.facility_type || "—"}</td>
                  <td className="px-3 py-2 text-ink-secondary">{r.exclusion_type ?? "—"}</td>
                  {/* 🔴 `배제반경_m: null` 은 「없음」이 아니라 **면(面) 배제 확정**이다.
                      0m 로 찍으면 배제가 안 걸린 것으로 읽힌다. */}
                  <td className="tnum px-3 py-2 text-right">
                    {r.배제반경_m === null
                      ? "면 배제"
                      : typeof r.배제반경_m === "number"
                        ? `${int(r.배제반경_m)} m`
                        : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.confirmed ? (
                      "확정"
                    ) : (
                      <span className="text-amber-700">미확정</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-[11px] text-ink-secondary">
        판정 근거와 확인 요청 원문은 <b>화면 2 · 감리 확인</b>에 있습니다.
      </p>
    </section>
  );
}

// ── 3. 정제 결과 ───────────────────────────────────────────────

function CleanSection({ clean, rep }: { clean: CleanReportDoc | null; rep: ReportDoc }) {
  if (!clean) {
    return (
      <section className="doc-section">
        <H id="s3">3. 정제 결과</H>
        <p className="mt-3 text-[13px] text-ink-secondary">
          <code>clean_report.json</code> 을 아직 읽지 못했습니다. 데이터 목록을 지어내지
          않습니다.
        </p>
      </section>
    );
  }
  const totalBefore = clean.results.reduce((s, r) => s + r.rows_before, 0);
  const totalAfter = clean.results.reduce((s, r) => s + r.rows_after, 0);
  const totalFlags = clean.results.reduce((s, r) => s + r.n_flags, 0);

  return (
    <section className="doc-section">
      <H id="s3">3. 정제 결과</H>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
        {clean.region} · {clean.facility} — 데이터셋 {clean.results.length}종. 원본{" "}
        {int(totalBefore)}행 → 정제 후 {int(totalAfter)}행. 정제 중 표시된 이상치{" "}
        {int(totalFlags)}건.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-hairline">
        <table className="w-full min-w-[720px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-hairline bg-black/[0.02] text-left text-ink-secondary">
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">파일</th>
              <th className="px-3 py-2 font-medium">역할</th>
              <th className="px-3 py-2 text-right font-medium">원본</th>
              <th className="px-3 py-2 text-right font-medium">정제 후</th>
              <th className="px-3 py-2 text-right font-medium">제거율</th>
              <th className="px-3 py-2 text-right font-medium">이상치</th>
            </tr>
          </thead>
          <tbody>
            {clean.results.map((r) => (
              <tr key={r.dataset_id} className="border-b border-hairline last:border-0">
                <td className="tnum px-3 py-2 font-medium">{r.dataset_id}</td>
                {/* 🔴 r.output 은 서버 절대경로다. 절대 화면에 내지 않는다. */}
                <td className="max-w-[240px] truncate px-3 py-2" title={r.filename}>
                  {r.filename}
                </td>
                <td className="px-3 py-2 text-ink-secondary">
                  {r.roles.map((x) => ROLE_LABEL[x] ?? x).join(" · ")}
                </td>
                <td className="tnum px-3 py-2 text-right">{int(r.rows_before)}</td>
                <td className="tnum px-3 py-2 text-right">{int(r.rows_after)}</td>
                <td className="tnum px-3 py-2 text-right">{percent(r.drop_ratio, 1)}</td>
                <td className="tnum px-3 py-2 text-right">
                  {r.n_flags > 0 ? <b className="text-amber-700">{int(r.n_flags)}</b> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-ink-secondary">
        가중치에 실제로 쓰인 지표는 {rep.weight_set.indicators.length}개입니다 — 데이터셋
        수와 다릅니다(배제·참고용은 점수에 안 들어갑니다).
      </p>
    </section>
  );
}

// ── 4. 배제 구역 ───────────────────────────────────────────────

function ExclusionSection({ rep }: { rep: ReportDoc }) {
  const sp = rep.spatial;
  const w = sp?.width_m ?? null;
  return (
    <section className="doc-section">
      <H id="s4">4. 배제 구역</H>
      {sp ? (
        <>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            <Item k="배제 union 면적" v={km2(sp.exclusion_union_km2)} />
            <Item k="지목 배수 판정(S9)" v={sp.shape_lift ? "적용" : "미적용"} />
            {/* 🔴 `spatial` 이 있어도 `width_m` 은 없을 수 있다 — 내접폭 컬럼이 없는
                지적도. 없는 계측을 "0 / 0" 으로 찍으면 읽는 사람이 "전부 탈락했다"로
                읽는다. 항목째로 빼고 사유를 적는다. */}
            {w && (
              <>
                <Item k="최소 내접폭 통과" v={`${int(w.pass_min_width)} / ${int(w.n)}`} />
                <Item k="기준 폭" v={`${fixed(w.min_width, 1)} m`} />
              </>
            )}
          </dl>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
            {w ? (
              <>
                필지 내접폭 중앙값 {fixed(w.median, 2)}m · p05 {fixed(w.p05, 2)}m · p95{" "}
                {fixed(w.p95, 2)}m · 최대 {fixed(w.max, 2)}m. 면적이 넓어도 길쭉한 필지는{" "}
                {rep.facility}가 안 들어갑니다 — 그래서 면적이 아니라 내접폭으로 거릅니다.
              </>
            ) : (
              <>
                이 실행에는 <b>내접폭 계측이 없습니다</b>(<code>spatial.width_m</code> 키
                없음). 지적도에 내접폭을 낼 수 있는 형태 정보가 없으면 계산되지 않습니다 —
                면적이 넓어도 길쭉해서 {rep.facility}가 못 들어가는 필지가 걸러지지
                않았다는 뜻입니다.
              </>
            )}
          </p>
          <p className="mt-2 text-[11px] text-ink-secondary">
            레이어별 내역과 근거는 <b>화면 2b · 배제 근거</b>에 있습니다.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-ink-secondary">
          이 실행에는 공간 계측 결과가 없습니다(<code>report.spatial = null</code>).
        </p>
      )}
    </section>
  );
}

// ── 5. 가중치 ──────────────────────────────────────────────────

function WeightSection({ rep }: { rep: ReportDoc }) {
  const ws = rep.weight_set;
  const sorted = [...ws.indicators].sort((a, b) => b.w_final - a.w_final);
  const max = Math.max(...ws.indicators.map((i) => i.w_final), 0);
  return (
    <section className="doc-section">
      <H id="s5">5. 가중치</H>
      <p className="mt-3 text-[13px] text-ink-secondary">
        사람 : 데이터 = {fixed(1 - ws.alpha, 2)} : {fixed(ws.alpha, 2)} · 거리 감쇠{" "}
        {ws.decay.func}(σ비 {fixed(ws.decay.sigma_ratio, 2)}) · 스케일 {ws.scale} · 후보{" "}
        {int(ws.n_candidates)}.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {sorted.map((i) => (
          <li key={i.id} className="flex items-center gap-3 text-[13px]">
            <span className="tnum w-16 shrink-0 rounded bg-black/[0.06] px-1.5 py-0.5 text-center text-[11px] text-ink-secondary">
              {i.id}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${max > 0 ? (i.w_final / max) * 100 : 0}%` }}
              />
            </span>
            <span className="tnum w-16 shrink-0 text-right font-medium">{fixed(i.w_final, 4)}</span>
            <span className="tnum w-20 shrink-0 text-right text-[11px] text-ink-secondary">
              반경 {i.radius_m === null ? "—" : `${int(i.radius_m)}m`}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-ink-secondary">
        지표 이름과 근거는 <b>화면 3 · 가중치</b>에 있습니다. 여기 id 는 데이터셋 번호
        조합입니다.
      </p>
    </section>
  );
}

// ── 6. 위치 선정 결과 (+ 지도 QR) ──────────────────────────────

function SiteSection({
  rows,
  pick,
  read,
}: {
  rows: TopNCsvRow[];
  pick: SitePick | null;
  read: boolean;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => a.순위 - b.순위), [rows]);
  /**
   * 🔴 **조인 키는 `pnu` 다.** 화면 4 가 고른 필지를 여기서 다시 찾는다.
   *    못 찾으면 `rank` 로 되짚지 않는다 — 순위는 실행이 바뀌면 다른 땅을 가리킨다.
   */
  const target = useMemo(
    () => (pick ? (sorted.find((r) => r.PNU === pick.pnu) ?? null) : null),
    [sorted, pick],
  );

  return (
    <section className="doc-section">
      <H id="s6">6. 위치 선정 결과</H>

      <TargetBlock pick={pick} target={target} read={read} />

      <p className="mt-5 text-[13px] text-ink-secondary">
        상위 {rows.length}곳. 순위는 점수가 아니라 <b>커버 기여</b> 순입니다 — 점수가 높아도
        앞 순위와 덮는 범위가 겹치면 뒤로 밀립니다.
      </p>
      {/* 🔴 **`table-fixed` + `<colgroup>` 이라야 안 잘린다.** 폭을 안 주면 브라우저가
          내용 길이대로 칸을 나눠서, 지번(「서울특별시 ○○구 ○○동 1234-5」)과
          「커버 기여(수요값)」 머리글이 폭을 다 먹고 **오른쪽 끝 「국유」가 잘려 나갔다**
          (2026-08-14 사용자 보고). `overflow-x-auto` 는 화면에서만 스크롤로 가려 줄
          뿐이고, 이 화면의 본체는 **인쇄물**이라 A4 밖으로 나간 칸은 그냥 없어진다.
          그래서 비율을 못 박아 **가로 스크롤 없이 한 장에 들어오게** 한다.
          합은 100 이어야 한다 — 넘으면 `table-fixed` 가 비례 축소하면서 다시 틀어진다.
          ⚠ 지목은 이제 부호 한 글자가 아니라 「주유소용지」 같은 정식 명칭이 들어와서
             (`jimokLabel`) 예전보다 넓어야 한다. 줄여 놓으면 두 줄로 접힌다. */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-hairline">
        <table className="w-full min-w-[620px] table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[17%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
            <col className="w-[11%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-hairline bg-black/[0.02] text-left align-bottom text-ink-secondary">
              <th className="px-2 py-2 font-medium">순위</th>
              <th className="px-2 py-2 font-medium">지번</th>
              <th className="px-2 py-2 font-medium">지목</th>
              <th className="px-2 py-2 text-right font-medium">면적</th>
              <th className="px-2 py-2 text-right font-medium">내접폭</th>
              <th className="px-2 py-2 text-right font-medium">점수</th>
              {/* 🔴 `커버기여` 는 비율이 아니라 수요값 절대량이다(= coverage.marginal).
                  `percent()` 로 찍었더니 4순위가 "6142.57%" 로 나왔다. 총 수요값이
                  산출물에 없어 백분율 환산이 불가능해서, 단위를 머리글에 밝히고
                  산출물 값을 그대로 쓴다. 진행 정도는 옆의 「누적 커버」로 읽는다. */}
              <th className="px-2 py-2 text-right font-medium">
                커버 기여
                <span className="block text-[10px] font-normal">(수요값)</span>
              </th>
              <th className="px-2 py-2 text-right font-medium">누적 커버</th>
              <th className="px-2 py-2 text-right font-medium">국유</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isTarget = target !== null && r.PNU === target.PNU;
              return (
                <tr
                  key={r.순위}
                  className={`border-b border-hairline last:border-0 ${
                    isTarget ? "bg-primary/5" : ""
                  }`}
                >
                  <td className="tnum px-2 py-2 font-semibold text-primary">
                    {r.순위}
                    {isTarget && <span className="block text-[10px]">◀ 대상지</span>}
                  </td>
                  <td className="break-all px-2 py-2">{r.JIBUN}</td>
                  <td className="px-2 py-2 text-ink-secondary">{jimokLabel(r.지목)}</td>
                  <td className="tnum px-2 py-2 text-right">{areaM2(r.면적)}</td>
                  <td className="tnum px-2 py-2 text-right">{fixed(r.내접폭, 2)} m</td>
                  <td className="tnum px-2 py-2 text-right">{fixed(r.점수, 4)}</td>
                  <td className="tnum px-2 py-2 text-right">{fixed(r.커버기여, 4)}</td>
                  <td className="tnum px-2 py-2 text-right">{percent(r.누적커버율, 1)}</td>
                  <td className="tnum px-2 py-2 text-right">
                    {r.국유_건수 > 0 ? percent(r.국유_지분율, 0) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-ink-secondary">
        지도는 <b>화면 4 · 위치 선정</b>에 있습니다. 좌표는 <code>topN.csv</code> 에만
        있어 이 표도 거기서 읽었습니다.
      </p>
    </section>
  );
}

/**
 * 대상지 카드 + 지도 QR.
 *
 * 🔴 QR 값은 **고른 후보의 실제 지번·경위도**로 만든다. `/hearing-pdf` 표본은
 *    `(37.534, 126.994)` "이태원동 123-4" 를 박아 두고 있었는데, 그건 백엔드가
 *    2026-08-10 에 제거한 테스트용 좌표 폴백과 같은 점이다. 인쇄돼 나간 QR 을
 *    찍으면 **엉뚱한 땅**이 열린다.
 *
 * 🔴 고른 게 없으면 **1순위로 대신하지 않는다.** `rank == 1` 은 추천이지 결정이
 *    아니다(2026-08-10 사람 결정). 사유를 적고 QR 을 만들지 않는다.
 */
function TargetBlock({
  pick,
  target,
  read,
}: {
  pick: SitePick | null;
  target: TopNCsvRow | null;
  read: boolean;
}) {
  if (!read) {
    return (
      <p className="mt-3 text-[13px] text-ink-secondary">대상지를 확인하는 중입니다…</p>
    );
  }
  if (!pick) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
        <b>대상지가 확정되지 않았습니다.</b> 화면 4(위치 선정)에서 후보를 고르면 그 필지의
        지번·좌표와 지도 QR 이 여기에 실립니다. 순위 1위를 대신 넣지 않습니다 — 순위는
        추천이지 결정이 아닙니다.
      </div>
    );
  }
  if (!target) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
        <b>고른 필지를 이 실행의 표에서 찾지 못했습니다.</b> 고른 값 — PNU{" "}
        <span className="tnum">{pick.pnu}</span> · {pick.jibun}(실행{" "}
        <span className="tnum">{pick.run_id ?? "—"}</span>). 지금 보고 있는 실행과 고른
        시점의 실행이 다를 수 있습니다. 같은 순위의 다른 필지로 대신 채우지 않습니다.
      </div>
    );
  }

  const addr = target.JIBUN;
  const kakaoUrl = `https://map.kakao.com/link/map/${encodeURIComponent(addr)},${target.위도},${target.경도}`;
  const naverUrl = `https://map.naver.com/v5/search/${encodeURIComponent(addr)}`;

  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-6 rounded-xl border border-hairline bg-black/[0.015] p-5">
      <div className="min-w-[240px] flex-1">
        <h3 className="text-[13px] font-semibold">대상지</h3>
        <p className="mt-1 text-[17px] font-semibold">{target.JIBUN}</p>
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-[12px] sm:grid-cols-2">
          <Item k="순위" v={`${target.순위}위`} />
          <Item k="지목" v={jimokLabel(target.지목)} />
          <Item k="면적" v={areaM2(target.면적)} />
          <Item k="내접폭" v={`${fixed(target.내접폭, 2)} m`} />
          <Item k="점수" v={fixed(target.점수, 4)} />
          <Item k="누적 커버" v={percent(target.누적커버율, 1)} />
          <Item k="PNU" v={target.PNU} mono />
          <Item k="좌표(위도, 경도)" v={`${fixed(target.위도, 6)}, ${fixed(target.경도, 6)}`} mono />
        </dl>
      </div>

      <div className="flex gap-5">
        <QrBox label="카카오맵" url={kakaoUrl} />
        <QrBox label="네이버지도" url={naverUrl} />
      </div>
    </div>
  );
}

function QrBox({ label, url }: { label: string; url: string }) {
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <div className="rounded-lg border border-hairline bg-white p-2">
        <QRCodeSVG value={url} size={84} level="M" />
      </div>
      <figcaption className="text-[11px] text-ink-secondary">{label}</figcaption>
    </figure>
  );
}

// ── 7. 커버율 ──────────────────────────────────────────────────

function CoverageSection({ rep }: { rep: ReportDoc }) {
  const cov = rep.coverage;
  return (
    <section className="doc-section">
      <H id="s7">7. 커버율</H>
      {cov ? (
        <>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(cov.reach)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([t, n]) => (
                <Item key={t} k={`${percent(Number(t), 0)} 덮으려면`} v={`${int(n)}곳`} />
              ))}
          </dl>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
            기울기가 꺾이는 지점은 {int(cov.knee)}곳입니다 — 그 뒤로는 하나 더 놓아도 덮이는
            면적이 확 줄어듭니다. 커버 상한은 {percent(cov.ceiling, 2)} 이고, 100% 가 아닌
            이유는 어떤 후보로도 닿지 않는 수요점이 {int(cov.unreached_n)}개 있기
            때문입니다(전체 수요점 {int(cov.n_demand)}개). 이건 계산 오류가 아니라 사실이며,
            9절에도 항목으로 남습니다.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-ink-secondary">
          이 실행에는 커버율 계산 결과가 없습니다(<code>report.coverage = null</code>).
        </p>
      )}
    </section>
  );
}

// ── 8. 공청회 토론 결과 ────────────────────────────────────────

/**
 * 🔴 **화면 5 는 엔진이 둘이고, 여기서 합치지 않는다.** A(대립)와 B(다인)는 참여자도
 *    지표도 다르다. 한 절에 섞으면 어느 엔진이 낸 결론인지 알 수 없다.
 *
 * 🔴 **출처가 둘이고, 이것도 합치지 않는다.** 서버 기록(본선)과 이 탭 기록(폴백)은
 *    **알 수 있는 것이 다르다** — 서버는 어느 run·어느 순위인지 조인으로 알지만
 *    (A 는 `css_pro/con`·수용도를 저장하지 않는다), 탭 기록은 그 반대다. 한쪽 모양으로
 *    접으면 없는 값을 지어내거나 있는 값을 버린다(원칙 4·5). 그래서 카드를 따로 두고
 *    배지로 출처를 적는다.
 *
 * 🔴 **탭 기록의 A 에는 범위가 없다.** 동현님 화면이 남기는 `sim_*` 키에는 주제·PNU 가
 *    없고 `sim_parcel`(parcel_id)만 있다. 그 값을 그대로 적고, 「지금 대상지의
 *    토론이다」로 단정하지 않는다 — 단정하면 다른 필지의 토론이 이 기획안의 근거가 된다.
 *    (서버 A 는 `jibun`·`rank` 가 같이 오므로 이 문제가 없다.)
 */
function HearingSection({
  served,
  a,
  b,
  read,
}: {
  served: RunHearingDetails;
  a: HearingResultA | null;
  b: HearingResultB | null;
  read: boolean;
}) {
  /**
   * 🔴 **같은 토론을 두 번 싣지 않는다.** 서버에서 받은 것과 이 탭 기록이 같은 토론이면
   *    로컬 쪽을 뺀다. 대조 키는 엔진마다 다르다 — B 는 저장 응답으로 받은
   *    `serverId`(= `hearing_id`) 로 **정확히** 갈리고, A 는 그런 값이 없어
   *    `parcel_id` 로만 본다(서버 A 는 그 필지의 최신 1건이므로 같은 필지면 같은
   *    토론이다). 두 번 실리면 읽는 사람은 공청회를 두 번 연 것으로 읽는다.
   */
  const localAIsDup = a !== null && served.a !== null && a.parcelId === served.a.item.parcel_id;
  const localBIsDup = b !== null && served.b !== null && b.serverId === served.b.item.hearing_id;
  const localA = localAIsDup ? null : a;
  const localB = localBIsDup ? null : b;

  const nothing =
    !served.loading && served.a === null && served.b === null && read && !localA && !localB;

  /** 서버가 센 건수 중 여기 싣지 못한 나머지. 「1건만 실었다」를 문서에 적기 위한 값이다. */
  const shown = (served.a ? 1 : 0) + (served.b ? 1 : 0);
  const rest = served.total === null ? 0 : Math.max(0, served.total - shown);

  return (
    <section className="doc-section">
      <H id="s8">8. 공청회 토론 결과</H>

      {served.loading || !read ? (
        <p className="mt-3 text-[13px] text-ink-secondary">토론 기록을 확인하는 중입니다…</p>
      ) : nothing ? (
        <div className="mt-3 rounded-xl border border-hairline bg-black/[0.015] px-4 py-3 text-[12px] leading-relaxed text-ink-secondary">
          <b className="text-ink">이 실행에 토론 기록이 없습니다.</b> 화면 5 에서 공청회를
          돌리면 그 발언과 지표가 여기에 실립니다. 표본 시나리오를 대신 넣지 않습니다.
          {served.failure && (
            <>
              <br />
              서버에는 물어보지 못했습니다 — <span className="tnum">{served.failure}</span>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
          {served.a && <ServerHearingACard s={served.a} />}
          {served.b && <ServerHearingBCard s={served.b} />}
          {localA && <HearingA a={localA} />}
          {localB && <HearingB b={localB} />}
        </div>
      )}

      {/*
        🔴 **출처와 못 실은 것을 문서에 적는다.** 「서버에서 읽었다」와 「이 탭에만 있다」는
           같은 값이 아니고, 뒤엣것은 탭을 닫으면 사라진다. 안 적으면 읽는 사람이
           이 기획안을 다시 열면 나오는 문서로 읽는다(원칙 4).
      */}
      <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-ink-secondary">
        {served.failure ? (
          <p>
            출처: <b>이 브라우저 탭의 기록</b> — 서버에 물어보지 못했습니다(
            {served.failure}). 탭을 닫으면 이 절은 비어집니다.
          </p>
        ) : (
          <p>
            출처: <b>서버에 저장된 공청회</b>
            {served.total !== null && <> (이 실행에 {int(served.total)}건)</>}
            {rest > 0 && <> — 엔진별 최신 1건만 실었고 나머지 {int(rest)}건은 뺐습니다.</>}
            {(localA || localB) && <> 서버에 없는 기록은 이 탭에서 읽어 함께 실었습니다.</>}
          </p>
        )}
        {served.detailFailure.A && <p>A 본문을 읽지 못했습니다 — {served.detailFailure.A}</p>}
        {served.detailFailure.B && <p>B 본문을 읽지 못했습니다 — {served.detailFailure.B}</p>}
      </div>
    </section>
  );
}

/** 서버 A 1건(`GET /simulations/results/{parcel_id}`). 필지의 **최신 1건**이다. */
function ServerHearingACard({ s }: { s: ServerHearingA }) {
  const lines: HearingLine[] = s.detail.debate_logs.map((l) => ({
    speaker: typeof l.sender === "string" && l.sender ? l.sender : "발언자 미상",
    text: typeof l.text === "string" ? l.text : "",
  }));
  const factors = s.detail.conflict_factors;
  return (
    <div className="rounded-xl border border-hairline p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-hairline bg-black/[0.04] px-2 py-0.5 text-[11px] font-semibold">
          A · 대립 토론
        </span>
        <span className="rounded border border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
          서버 기록
        </span>
        <span className="text-[12px] text-ink-secondary">
          발언 {int(lines.length)}건 · {datetime(s.item.created_at)}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <Item k="대상 지번" v={s.item.jibun || "—"} />
        <Item k="후보 순위" v={s.item.rank === null ? "—" : `${int(s.item.rank)}순위`} />
        <Item k="parcel_id" v={String(s.item.parcel_id)} mono />
        <Item
          k="갈등 민감도(CSS)"
          v={s.detail.conflict_sensitivity_score === null ? "—" : fixed(s.detail.conflict_sensitivity_score, 2)}
        />
      </dl>

      {factors && Object.keys(factors).length > 0 && (
        <div className="mt-3">
          <h4 className="text-[12px] font-semibold">갈등 요인별 값</h4>
          <dl className="mt-1.5 grid gap-x-8 gap-y-1 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(factors).map(([k, v]) => (
              <Item key={k} k={k} v={fixed(v, 4)} />
            ))}
          </dl>
        </div>
      )}

      {s.detail.scenario && (
        <div className="mt-3">
          <h4 className="text-[12px] font-semibold">조정 시나리오(엔진 원문)</h4>
          {/* 🔴 키를 골라 표로 만들지 않는다 — 리포터 노드가 필드를 늘리면 옛 값만 보인다. */}
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-lg border border-hairline bg-black/[0.02] p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
            {JSON.stringify(s.detail.scenario, null, 2)}
          </pre>
        </div>
      )}

      <Transcript
        lines={lines}
        onDownload={() =>
          downloadHearingJson(
            { item: s.item, detail: s.detail },
            `토론기록_A_parcel-${s.item.parcel_id}_${fileStamp(s.item.created_at ?? "")}.json`,
          )
        }
      />
    </div>
  );
}

/**
 * 서버 B 1건(`GET /simulations/hearings/b/{id}`).
 *
 * 🔴 `result_json` 은 서버가 **통짜로** 내보내는 값이라 모양을 우리가 정하지 않는다.
 *    발언만 꺼내 보되 **못 꺼내면 못 꺼냈다고 적고 원문을 싣는다** — 조용히 비면
 *    「토론을 안 했다」로 읽힌다(원칙 1·4).
 */
function ServerHearingBCard({ s }: { s: ServerHearingB }) {
  const lines = linesFromResultJson(s.detail.result_json);
  return (
    <div className="rounded-xl border border-hairline p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-hairline bg-black/[0.04] px-2 py-0.5 text-[11px] font-semibold">
          B · 다인 토론
        </span>
        <span className="rounded border border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
          서버 기록
        </span>
        <span className="text-[12px] text-ink-secondary">
          발언 {int(s.detail.message_count)}건 · 참여 {int(s.item.persona_count)}명 ·{" "}
          {datetime(s.item.created_at)}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
        <Item k="안건" v={s.detail.topic || "—"} />
        <Item k="목적" v={s.detail.purpose || "—"} />
        <Item k="대상 지번" v={s.item.jibun || "—"} />
        <Item k="후보 순위" v={s.item.rank === null ? "—" : `${int(s.item.rank)}순위`} />
        <Item k="hearing_id" v={String(s.detail.hearing_id)} mono />
        <Item k="적재 run_id" v={s.detail.run_id ?? "—"} mono />
      </dl>

      {lines === null ? (
        <p className="mt-3 text-[12px] leading-relaxed text-amber-700">
          서버 기록에서 발언 목록을 읽지 못했습니다(`result_json.messages` 모양이 다릅니다).
          아래에 서버가 준 원문을 그대로 싣습니다 — 임의로 해석하지 않았습니다.
        </p>
      ) : (
        <Transcript
          lines={lines}
          onDownload={() =>
            downloadHearingJson(
              { item: s.item, detail: s.detail },
              `토론기록_B_${s.detail.hearing_id}_${fileStamp(s.item.created_at ?? "")}.json`,
            )
          }
        />
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-semibold">서버 원문(result_json)</summary>
        <pre className="mt-1.5 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-hairline bg-black/[0.02] p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
          {JSON.stringify(s.detail.result_json, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/**
 * B 서버 원문에서 발언만 꺼낸다. **모양이 안 맞으면 `null`** — 빈 배열로 돌려주면
 * 「발언이 없는 토론」이 되어 원문이 있다는 사실까지 지워진다.
 */
function linesFromResultJson(result: unknown): HearingLine[] | null {
  if (typeof result !== "object" || result === null) return null;
  const msgs = (result as { messages?: unknown }).messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  const out: HearingLine[] = [];
  for (const m of msgs) {
    if (typeof m !== "object" || m === null) return null;
    const row = m as { speaker?: unknown; text?: unknown };
    if (typeof row.text !== "string") return null;
    const sp = row.speaker;
    const speaker =
      typeof sp === "string"
        ? sp
        : typeof sp === "object" && sp !== null && typeof (sp as { name?: unknown }).name === "string"
          ? ((sp as { name: string }).name)
          : "발언자 미상";
    const kind =
      typeof sp === "object" && sp !== null && typeof (sp as { kind?: unknown }).kind === "string"
        ? (sp as { kind: string }).kind
        : undefined;
    out.push({ speaker, text: row.text, kind });
  }
  return out;
}

function HearingA({ a }: { a: HearingResultA }) {
  const m = a.metrics;
  return (
    <div className="rounded-xl border border-hairline p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-hairline bg-black/[0.04] px-2 py-0.5 text-[11px] font-semibold">
          A · 대립 토론
        </span>
        <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          이 탭에만 있음
        </span>
        <span className="text-[12px] text-ink-secondary">
          발언 {int(a.lines.length)}건 · {a.finished ? "종료됨" : "종료 표시 없음"}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <Item k="토론한 후보 parcel_id" v={a.parcelId === null ? "—" : String(a.parcelId)} mono />
        <Item k="찬성측 갈등 등급" v={m?.cssPro ?? "—"} />
        <Item k="반대측 갈등 등급" v={m?.cssCon ?? "—"} />
        {/*
          🔴 `percent()` 를 쓰지 않는다. 저장값이 **이미 퍼센트**(0~100)라 100 을 또
             곱하면 `45` 가 **4500%** 로 나간다(2026-08-11 실측). 타입 주석이
             「0~1」이라고 말하고 있어서 안 걸렸다 — 쓰는 쪽을 읽고 고쳤다.
        */}
        <Item
          k="수용도(찬성 · 반대)"
          v={`${pct100(m?.proAccept ?? null)} · ${pct100(m?.conAccept ?? null)}`}
        />
      </dl>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
        A 엔진 기록에는 주제·PNU 가 없어 <b>parcel_id 만</b> 대조할 수 있습니다. 위 6절의
        대상지와 같은 점인지 확인하고 인용하십시오.
      </p>

      <Transcript
        lines={a.lines}
        /*
         * 🔴 파일명에 **시각을 넣지 않는다.** A 기록에는 저장 시각이 없다
         *    (`sim_*` 키에 없다) — 내려받은 시각을 적으면 토론한 시각으로 읽힌다.
         *    대조할 수 있는 건 `parcel_id` 하나뿐이라 그것만 적는다.
         */
        onDownload={() =>
          downloadHearingJson(a, `토론기록_A_parcel-${a.parcelId ?? "미상"}.json`)
        }
      />
    </div>
  );
}

function HearingB({ b }: { b: HearingResultB }) {
  /**
   * 🔴 키 이름이 바뀌었다(2026-08-11 백엔드 SSE 정규화) —
   *    `round_count` → `round` · `reporter` → `report`.
   *    **옛 이름도 같이 본다.** 이 값은 sessionStorage 에 이미 저장돼 있을 수
   *    있고(`omnisite.hearingB.v1`), 새 이름만 보면 계약 바뀌기 전에 돈 토론이
   *    보고서에서 라운드 `—` · 시나리오 없음으로 조용히 비어 버린다.
   *    옛 기록이 다 사라지면 뒤쪽 폴백을 지운다.
   */
  const rounds =
    typeof b.status?.round === "number"
      ? b.status.round
      : typeof b.status?.round_count === "number"
        ? b.status.round_count
        : null;
  const reporter = b.status?.report ?? b.status?.reporter;
  return (
    <div className="rounded-xl border border-hairline p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-hairline bg-black/[0.04] px-2 py-0.5 text-[11px] font-semibold">
          B · 다인 토론
        </span>
        {/*
          🔴 저장 실패와 「서버가 아무 말도 안 함」을 갈라 적는다. 둘 다 이 탭에만
             있지만 앞은 **서버가 거절했다**는 사실이 따로 남아야 한다(원칙 4).
        */}
        <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          {b.saveError ? "서버 저장 실패" : "이 탭에만 있음"}
        </span>
        <span className="text-[12px] text-ink-secondary">
          발언 {int(b.lines.length)}건 · 참여 {int(b.participants.length)}명 ·{" "}
          {datetime(b.savedAt)}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
        <Item k="안건" v={b.scope.topic || "—"} />
        <Item k="목적" v={b.scope.purpose || "—"} />
        <Item k="대상 지번" v={b.scope.jibun || "—"} />
        <Item k="대상 PNU" v={b.scope.pnu || "—"} mono />
        <Item k="라운드" v={rounds === null ? "—" : `${int(rounds)}회`} />
        <Item k="적재 run_id" v={b.scope.runId ?? "—"} mono />
        <Item
          k="서버 저장"
          v={
            b.serverId !== null
              ? `저장됨 (hearing_id ${b.serverId})`
              : b.saveError
                ? `실패 — ${b.saveError}`
                : "서버가 저장 여부를 알리지 않았습니다"
          }
        />
      </dl>

      {b.participants.length > 0 && (
        <div className="mt-3">
          <h4 className="text-[12px] font-semibold">참여 이해관계자</h4>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {b.participants.map((p, i) => (
              <li
                key={`${p}-${i}`}
                className="rounded-md border border-hairline bg-black/[0.03] px-2 py-0.5 text-[11px] text-ink-secondary"
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reporter !== undefined && (
        <div className="mt-3">
          <h4 className="text-[12px] font-semibold">최종 시나리오(엔진 원문)</h4>
          {/*
            🔴 모양을 우리가 정하지 않는다. `final_scenarios` 의 필드는 백엔드
               리포터 노드가 정하고 그쪽이 바뀔 수 있다 — 키를 골라 표로 만들면
               필드가 늘었을 때 화면만 조용히 옛 값을 보인다. 원문을 그대로 싣는다.
          */}
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-lg border border-hairline bg-black/[0.02] p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
            {JSON.stringify(reporter, null, 2)}
          </pre>
        </div>
      )}

      <Transcript
        lines={b.lines}
        /* B 는 범위를 저장한다 → 파일명만 봐도 어느 필지·언제 돈 토론인지 갈린다. */
        onDownload={() =>
          downloadHearingJson(
            b,
            `토론기록_B_${b.scope.pnu ?? b.scope.domain ?? "범위없음"}_${fileStamp(b.savedAt)}.json`,
          )
        }
      />
    </div>
  );
}

/**
 * 토론 기록 **원본**을 파일로 내린다.
 *
 * 🔴 받은 값을 **그대로** 넘긴다 — 여기서 키를 골라 담으면 내려받은 파일이 「원본」인
 *    척하면서 다른 값이 된다. 서버 기록이면 목록 행(`item`)과 본문(`detail`)을 **둘 다**
 *    담는다: 본문에는 이 토론이 어느 run·어느 순위였는지가 없고, 그건 조인으로만
 *    붙는 값이라 여기서 빼면 다시 알아낼 수 없다.
 *    탭 기록(폴백)이면 이 파일이 탭을 닫은 뒤 남는 **유일한 사본**이다.
 */
function downloadHearingJson(record: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(record, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url;
  el.download = filename;
  el.click();
  URL.revokeObjectURL(url);
}

/** 이미 퍼센트인 값(0~100)을 표시용으로. 없으면 `—` — `0%` 로 지어내지 않는다. */
function pct100(v: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? `${Math.round(v)}%` : "—";
}

/** ISO 시각을 파일명에 쓸 수 있는 모양으로. 값은 안 바꾼다(구분자만 바꾼다). */
function fileStamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

/**
 * 발언 기록. 길면 **발췌**하고 전문은 내려받게 한다.
 * `onDownload` 를 여기서 만들지 않는 이유 — 무엇을 내려받는지는 엔진마다 다르고
 * (A 는 범위가 없다) 파일명도 다르다. 그 판단은 호출부가 한다.
 */
function Transcript({ lines, onDownload }: { lines: HearingLine[]; onDownload: () => void }) {
  const full = lines.length <= TRANSCRIPT_INLINE_MAX;
  const head = full ? lines : lines.slice(0, TRANSCRIPT_HEAD);
  const tail = full ? [] : lines.slice(lines.length - TRANSCRIPT_TAIL);
  const omitted = lines.length - head.length - tail.length;

  return (
    <div className="mt-4 rounded-lg border border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <h4 className="text-[12px] font-medium">
          발언 기록 {int(lines.length)}건
          {!full && (
            <span className="ml-1.5 font-normal text-ink-secondary">
              — 앞 {TRANSCRIPT_HEAD}건 · 뒤 {TRANSCRIPT_TAIL}건 발췌
            </span>
          )}
        </h4>
        {/* 인쇄물에는 누를 수 없는 버튼이 남으면 안 된다 → `doc-hide` */}
        <button
          type="button"
          onClick={onDownload}
          className="doc-hide btn-utility gap-1.5 text-[12px]"
        >
          <Download size={13} /> 전문 JSON 내려받기
        </button>
      </div>

      <ul className="flex flex-col gap-2 p-3">
        {head.map((l, i) => (
          <li key={`h-${i}`} className="text-[12px] leading-relaxed">
            <b className="text-ink">{l.speaker}</b>{" "}
            <span className="text-ink-secondary">{l.text}</span>
          </li>
        ))}

        {omitted > 0 && (
          <li className="rounded-md border border-dashed border-hairline bg-black/[0.015] px-3 py-2 text-[11px] leading-relaxed text-ink-secondary">
            가운데 <b className="text-ink">{int(omitted)}건</b>은 문서에 싣지 않았습니다 —
            <b> 요약한 것이 아니라 생략</b>한 것입니다. 뺀 발언에 무엇이 있었는지는 위
            「전문 JSON 내려받기」로 확인하십시오.
          </li>
        )}

        {tail.map((l, i) => (
          <li key={`t-${i}`} className="text-[12px] leading-relaxed">
            <b className="text-ink">{l.speaker}</b>{" "}
            <span className="text-ink-secondary">{l.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 9. 개선 방법 ────────────────────────────────────────────────

/**
 * 이 run 이 **어떻게 실행됐는지**. 조치 문구가 여기에 따라 갈린다.
 *
 * 🔴 조치는 **이 프런트에서 실제로 누를 수 있는 것**이어야 한다(2026-08-15 사용자 지시).
 *    예전 문구는 「배제 규칙을 완화하거나 후보 범위를 넓혀」처럼 **화면에 없는 동작**을
 *    시켰다. 읽는 사람은 그걸 어디서 하는지 못 찾는다 — 조치가 아니라 소원이다.
 *
 * 🔴 그래서 **실행 설정을 보고 문구를 고른다.** 같은 결함이라도 프리셋으로 돌린 run 과
 *    업로드로 돌린 run 은 손댈 수 있는 자리가 다르다 — 「입지 선정 개수 (Top-N)」는
 *    `full` 에서만 전송되고(`app/page.tsx` 의 「이 모드에서는 전송되지 않음」),
 *    업로드 칸 자체가 「실제 데이터 업로드」로 시작한 실행에만 있다.
 */
interface RunSetup {
  /** 「고속 자동 분석 모드」였나. `undefined` = 서버가 안 알려준 실행이다(옛 run). */
  auto: boolean | undefined;
  /** `full` = 「실제 데이터 업로드」로 시작한 실행. 업로드 칸과 Top-N 이 이쪽에만 있다. */
  full: boolean;
}

/**
 * `data_gap.kind` 를 **「다시 돌릴 때 어느 화면에서 무엇을 바꾸면 되는지」** 로 바꾼다.
 *
 * 🔴 원래는 `배제판정_확인요청` 같은 **내부 코드값을 그대로 제목에 찍고** 있었다.
 *    이 문서를 읽는 건 담당 공무원이지 이 엔진을 만든 사람이 아니다.
 *
 * 🔴 **뜻풀이를 길게 달았다가 걷어냈다**(2026-08-15 사용자 지시). 「엔진이 왜 그렇게
 *    판단했는지」를 문단으로 설명해 놨는데, 읽는 사람이 원하는 건 사유가 아니라
 *    **다음에 뭘 누르면 되는지**다. 남기는 건 조치 한 줄뿐이다.
 *
 * ⚠ 화면 이름·단계 이름은 **실물에서 가져온 것만 쓴다** — 화면 2 의 「금지 구역 선정
 *   배경」·「데이터 역할 확인」은 `app/audit/page.tsx` 의 스테퍼 4·5 라벨이고,
 *   「입지 선정 개수 (Top-N)」·「실제 데이터 업로드」는 `app/page.tsx` 의 라벨이다.
 *   여기서 이름을 지어내면 보고서가 없는 버튼을 누르라고 시킨다.
 *
 * ⚠ 「화면 3 에서 수요 지표의 중요도를 올리라」고는 못 쓴다 — 가중치 지표는 산출물에
 *   `07+02` · `04` 같은 **부호로만** 온다(`weight_set.indicators`). 어느 것이 수요인지
 *   프런트가 모르는데 지목해 주면 엉뚱한 슬라이더를 만지게 한다.
 *
 * ⚠ 모르는 `kind` 는 **지어내지 않는다.** 코드값을 그대로 제목으로 쓰고 조치는 비운다.
 *   백엔드가 새 종류를 추가했을 때 그럴듯한 오역을 붙이는 게 더 위험하다.
 */
const GAP_KIND: Readonly<
  Record<string, { title: string; todo: (s: RunSetup) => string }>
> = {
  배제판정_확인요청: {
    title: "배제 규칙 다시 보기",
    todo: (s) =>
      (s.auto === true ? "이 실행은 이 자리를 AI 제안값으로 넘겼습니다. " : "") +
      "화면 2 「금지 구역 선정 배경」에서 배제 반경을, 「데이터 역할 확인」에서 " +
      "해당 데이터셋의 역할을 다시 정하고 실행하면 아래 지목의 배제가 달라집니다.",
  },
  주변이격_미적용: {
    title: "시설 위치 데이터 올리기",
    todo: (s) =>
      s.full
        ? "화면 1 의 업로드에 아래 지목의 시설 위치 데이터를 더해 다시 실행하면 " +
          "「주변 몇 m 이내 금지」가 적용됩니다."
        : "이 실행은 업로드 없이 저장된 데이터로 돌았습니다. 화면 1 에서 " +
          "「실제 데이터 업로드」로 시작해 아래 지목의 시설 위치 데이터를 올리면 " +
          "「주변 몇 m 이내 금지」가 적용됩니다.",
  },
  수요_도달불가: {
    title: "후보 범위 넓히기",
    todo: (s) =>
      s.full
        ? `화면 1 의 「입지 선정 개수 (Top-N)」를 지금보다 크게(최대 ${TOPN_MAX}) 잡거나, ` +
          "화면 2 「금지 구역 선정 배경」에서 배제 반경을 줄여 다시 실행하십시오."
        : "화면 2 「금지 구역 선정 배경」에서 배제 반경을 줄이면 후보가 늘어납니다. " +
          "「입지 선정 개수 (Top-N)」까지 늘리려면 화면 1 에서 " +
          "「실제 데이터 업로드」로 시작해야 합니다.",
  },
};

/**
 * `data_gap` 의 문장을 읽는 사람 쪽으로 조금 옮긴다 — 지목 부호와 `dataset` 뿐이다.
 *
 * ⚠ **여기서 문장을 다시 쓰지는 않는다.** 백엔드가 만든 문구를 프런트가 뜻을 짐작해
 *   바꾸면 그 순간 보고서가 사실과 달라진다(원칙 4).
 */
function gapText(text: string): string {
  return jimokText(text).replace(/\bdataset\b/g, "데이터셋");
}

function GapSection({ gaps, run }: { gaps: DataGap[]; run: RunDoc | null }) {
  const setup: RunSetup = {
    auto: run?.auto_approve,
    full: run?.mode === MODE_FULL,
  };

  const byKind = new Map<string, DataGap[]>();
  for (const g of gaps) {
    const list = byKind.get(g.kind) ?? [];
    list.push(g);
    byKind.set(g.kind, list);
  }
  return (
    <section className="doc-section">
      <H id="s9">9. 개선 방법</H>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
        {gaps.length === 0 && setup.auto !== true
          ? "이번 실행에서 손볼 것으로 남은 항목은 없습니다."
          : "아래를 손보고 다시 실행하면 결과가 나아집니다."}
      </p>

      {/*
        🔴 **실행 방식이 첫 번째 개선 지점이다.** 결함 목록보다 위에 둔다 — 게이트를
           AI 가 대신 답한 실행이면 아래 조치들("화면 2 에서 다시 정하십시오")을 애초에
           할 수가 없다. 순서를 뒤집으면 못 누르는 버튼부터 읽힌다.
        🔴 `auto_approve === true` **일 때만** 띄운다. `undefined` 는 서버가 안 알려준
           옛 run 이고, 모르는 것을 「맞춤형으로 돌았다」고 단정하지 않는다(원칙 4).
           맞춤형으로 돌았다면 여기서 더 나아질 것이 없으니 띄울 것도 없다.
      */}
      {setup.auto === true && (
        <div className="mt-4">
          <h3 className="text-[13px] font-semibold">실행 방식 바꾸기</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
            화면 1 의 마지막 단계에서 「맞춤형 대화 분석 모드」를 고르면, 아래 자리들을
            AI 제안값이 아니라 직접 확정한 뒤 결과를 뽑을 수 있습니다.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            <li className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-[12px] leading-relaxed">
              이 실행은 「고속 자동 분석 모드」였습니다 — 화면 2 「금지 구역 선정 배경」·
              「데이터 역할 확인」과 화면 3 「중요도」를 AI 제안값으로 자동 승인했습니다.
            </li>
          </ul>
        </div>
      )}

      {[...byKind.entries()].map(([kind, list]) => {
        const meta = GAP_KIND[kind];
        return (
          <div key={kind} className="mt-4">
            <h3 className="text-[13px] font-semibold">
              {meta?.title ?? kind} <span className="text-ink-secondary">· {list.length}건</span>
            </h3>
            {meta && (
              <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
                {meta.todo(setup)}
              </p>
            )}
            {/* 🔴 카드 안은 **`target` 한 줄뿐이다.** `detail`·`impact`·`review` 를 다
                펼쳐 놨었는데(「면 판정 · 배수 13.83x」 · JSON 덩어리), 읽는 사람에게는
                무엇을 해야 하는지가 그 밑에 깔려 안 보였다(2026-08-15 사용자 지시).
                지운 게 아니라 **이 절에서 안 쓰는 것**이다 — 판정 숫자가 필요하면
                산출물 `report.json` 의 `data_gap[].review` 에 그대로 있다. */}
            <ul className="mt-2 flex flex-col gap-2">
              {list.map((g, i) => (
                <li
                  key={`${kind}-${i}`}
                  className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-[12px] leading-relaxed"
                >
                  {gapText(g.target)}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

// ── 공통 ───────────────────────────────────────────────────────

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-8 scroll-mt-20 border-b border-hairline pb-2 text-[16px] font-semibold">
      {children}
    </h2>
  );
}

function Item({
  k,
  v,
  mono,
  tone,
}: {
  k: string;
  v: string;
  mono?: boolean;
  tone?: "warn";
}) {
  return (
    <div>
      <dt className="text-[12px] text-ink-secondary">{k}</dt>
      <dd
        className={`font-medium ${mono ? "tnum text-[12px]" : "tnum"} ${
          tone === "warn" ? "text-amber-700" : ""
        }`}
      >
        {v}
      </dd>
    </div>
  );
}
