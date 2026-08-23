"use client"; // force reload

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useCallback, useEffect } from "react";
import { AuditGate } from "@/components/gate/AuditGate";
import { ArtifactView } from "@/components/ui/ArtifactView";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { GATE_AUDIT, openGate } from "@/lib/omnisite/gate";
import { loadFacility, loadReviewed } from "@/lib/omnisite/pipeline";
import { useRun } from "@/lib/omnisite/RunProvider";
import { SCREENS } from "@/lib/omnisite/screens";
import { ExclusionContent } from "@/app/audit/exclusion/page";
import { useArtifact } from "@/lib/omnisite/useArtifact";
import { useAuditEta } from "@/lib/omnisite/useAuditEta";
import { meters } from "@/lib/omnisite/format";
import type { FacilityInference, ReviewedDoc, ReviewedRole, RunDoc, RunGate } from "@/lib/omnisite/types";

const SCREEN = SCREENS.find((s) => s.no === "2")!;
const SCREEN_2B = SCREENS.find((s) => s.no === "2b")!;

const ROLE_LABEL: Record<string, string> = {
  positive_factor: "가점 요인",
  negative_factor: "감점 요인",
  hard_exclusion: "설치 금지",
  reference_only: "참조만",
};

export default function Screen2Page() {
  const { run } = useRun();
  const router = useRouter();
  const state = useArtifact("reviewed", loadReviewed);
  /**
   * STEP1「선정 대상」전용 산출물. 감리(실측 238초)보다 **먼저** 나온다(실측 15초).
   * 🔴 `full` 에만 있다 — fixture·hitl 은 STEP0-1 을 안 돌므로 아래에서 `reviewed`
   *    로 되짚는다. 되짚기를 빼면 프리셋 run 의 선정 대상이 통째로 빈다.
   */
  const facility = useArtifact("facility", loadFacility);
  const gate = openGate(run, GATE_AUDIT);
  const [cachedGate, setCachedGate] = useState<RunGate | null>(null);

  // run_id가 나중에 로드되더라도 localStorage에서 cachedGate를 복구하도록 수정
  useEffect(() => {
    if (typeof window !== "undefined" && run?.run_id && !cachedGate) {
      try {
        const item = window.localStorage.getItem(`omnisite_gate_${run.run_id}_audit`);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (item) setCachedGate(JSON.parse(item));
      } catch (e) {}
    }
  }, [run?.run_id, cachedGate]);

  useEffect(() => {
    if (gate && run?.run_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCachedGate(gate);
      window.localStorage.setItem(`omnisite_gate_${run.run_id}_audit`, JSON.stringify(gate));
    }
  }, [gate, run?.run_id]);
  
  const displayGate = gate ?? cachedGate;

  /**
   * 「아직 도는 중이다」 판정. **한 곳에서만 한다** — 화면(STEP3 박스)과
   * 바닥 버튼이 각자 계산하면 언젠가 한쪽만 고쳐진다.
   *
   * 두 갈래를 OR 로 묶는다:
   *   ⓐ `state.data` 가 없다 = 감리 산출물(`reviewed.json`)이 아직 안 나왔다.
   *      `full` 은 여기가 몇 분이다 — 이 갈래가 없으면 그 동안 화면이 빈 채로 있다.
   *   ⓑ 게이트A 를 제출한 뒤 STEP2~3 이 도는 중(산출물은 이미 있다).
   */
  const auditPending = !state.data;
  /**
   * 선정 대상 값. 같은 값을 두 산출물이 다른 시점에 내므로 **빠른 쪽을 먼저** 본다.
   * 둘 다 없으면 `null` 이고, 그때는 아래 `ArtifactView` 의 기존 분기가 무슨 말을
   * 할지 정한다 — 여기서 대기 화면을 다시 만들지 않는다.
   */
  const facilityInference: FacilityInference | null =
    facility.data ?? state.data?.facility_inference ?? null;
  const isProcessing =
    auditPending || run?.status === "running" || run?.status === "queued" || run?.gate?.id === "audit";

  const [step, setStep] = useState(() => {
    if (typeof window !== "undefined" && run?.run_id) {
      const saved = window.sessionStorage.getItem(`audit_step_${run.run_id}`);
      if (saved) return parseInt(saved, 10);
    }
    return 1;
  });

  useEffect(() => {
    if (run?.run_id && typeof window !== "undefined") {
      window.sessionStorage.setItem(`audit_step_${run.run_id}`, step.toString());
    }
  }, [step, run?.run_id]);

  /**
   * 「[다음 단계] 를 아직 못 누른다」 판정.
   *
   * 🔴 단계마다 **기다리는 대상이 다르다.**
   *   STEP1「선정 대상」은 감리 결과를 한 글자도 안 쓴다 — 시설·지역이 나온
   *   순간(실측 ~15초) 넘어갈 수 있다. 여기서 `auditPending` 을 보면 값이 다
   *   나와 있는데도 몇 분을 막는다.
   *   STEP2「규칙 확인」부터가 감리 산출물을 읽는 자리이고, 그 대기 화면은
   *   아래 `ArtifactView` 의 `runningFallback`(= `Processing`)이 그린다 —
   *   사람은 **기다림을 겪어야 하는 단계에서** 기다린다.
   */
  const nextBlockedByPending = step === 1 ? !facilityInference : auditPending;

  const [isSubmittingGate, setIsSubmittingGate] = useState(false);
  const gateSubmitRef = useRef<(() => Promise<boolean | void>) | null>(null);
  const [isGateReady, setIsGateReady] = useState(false);
  const [gateProgress, setGateProgress] = useState({ confirmed: 0, total: 0 });
  const [isWaitingForSync, setIsWaitingForSync] = useState(false);

  const handleProgressChange = useCallback((confirmed: number, total: number) => {
    setGateProgress(prev => prev.confirmed === confirmed && prev.total === total ? prev : { confirmed, total });
  }, []);

  const handleNext = async () => {
    if (step === 2 && gate) {
      if (!gateSubmitRef.current) return;
      setIsSubmittingGate(true);
      try {
        const result = await gateSubmitRef.current();
        if (result !== false) {
          setIsWaitingForSync(true);
          setStep(3); // Go to explicit processing step
        }
      } catch(e) {
        console.error(e);
      } finally {
        setIsSubmittingGate(false);
      }
    } else {
      setStep(step + 1);
    }
  };

  useEffect(() => {
    if (isWaitingForSync && run) {
      const isRunning = run.status === "queued" || run.status === "running";
      
      if (run.status === "failed") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsWaitingForSync(false);
        return;
      }

      // 백엔드 응답이 오더라도 아직 상태 업데이트 전이라 awaiting_hitl / audit gate 상태일 수 있음.
      // 완전히 러닝(queued/running)이 끝났고, 동시에 audit gate가 아닐 때(다음 게이트로 넘어갔거나 완료됐을 때)만 통과시킴.
      if (!isRunning && (!run.gate || run.gate.id !== "audit")) {
        setIsWaitingForSync(false);
      }
    }
  }, [run, run?.status, run?.gate?.id, isWaitingForSync, step]);

  return (
    <PageBody>
      <PageHeader
        screen={SCREEN}
      />

      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 mt-6 overflow-hidden min-h-0">
        
        {/* 전체 컨텐츠 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* Stepper */}
          <div className="flex items-center justify-between mb-10 pb-6 border-b border-gray-100">
            <div className="flex items-center gap-4 flex-1 pr-8">
              <StepIcon current={step} stepNum={1} label="선정 대상" />
              <div className="h-px flex-1 bg-gray-200" />
              <StepIcon current={step} stepNum={2} label="규칙 확인" />
              <div className="h-px flex-1 bg-gray-200" />
              <StepIcon current={step} stepNum={3} label="데이터 처리 중" />
              <div className="h-px flex-1 bg-gray-200" />
              <StepIcon current={step} stepNum={4} label="금지 구역 선정 배경" />
              <div className="h-px flex-1 bg-gray-200" />
              <StepIcon current={step} stepNum={5} label="데이터 역할 확인" />
            </div>
            <div className="shrink-0 text-[11px] font-bold text-gray-500 uppercase tracking-widest px-4 py-1.5 bg-gray-50 rounded-full border border-gray-200">
              Step {step} of 5
            </div>
          </div>

          {/*
            🔴 STEP1 만 `ArtifactView` **밖**에 있다. 이 단계는 감리 결과를 한 글자도
               안 쓰는데, 안에 두면 감리(실측 238초)가 끝날 때까지 시설·지역 한 줄
               때문에 대기 화면이 떴다. 값이 없을 때의 판정은 여전히 안쪽 한 곳이다 —
               `facilityInference` 가 null 이면 그대로 `ArtifactView` 로 떨어진다.
          */}
          {step === 1 && facilityInference ? (
            <TargetSection fi={facilityInference} />
          ) : (
          <ArtifactView
            state={state}
            what="감리 결과"
            runningFallback={<AuditProcessing run={run ?? null} />}
          >
            {(doc) => (
              <>
                {step === 1 && <Body doc={doc} hideFlags hideTarget={false} />}
                {step === 2 && (
                  <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        <h2 className="text-[20px] font-bold text-gray-900 tracking-tight">규칙 확인</h2>
                        <span className="text-sm text-gray-500 ml-2">AI가 확정짓지 못한 규칙들을 직접 검토하고 확정해주세요.</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!gate ? (
                          <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${run?.auto_approve ? "bg-violet-100 text-violet-700 border-violet-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}`}>
                            {run?.auto_approve ? "AI 자동 승인됨" : "제출 완료"}
                          </span>
                        ) : (
                          <>
                            <span className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-full text-xs font-bold border border-orange-200">
                              검토 대기 {gateProgress.total > 0 ? gateProgress.total - gateProgress.confirmed : (displayGate?.questions.length ?? 0)}건
                            </span>
                            <span className="px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-xs font-bold border border-green-200">
                              확정 완료 {gateProgress.confirmed}건
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/*
                      🔴 게이트가 없을 때 **빈 상자를 그리지 않는다.** 「고속 자동 분석」
                         run 은 서버가 게이트를 세운 뒤 AI 제안값으로 대신 답하므로
                         프런트에는 질문이 한 번도 안 온다 — 예전엔 이 자리가 통째로
                         비어서 화면이 「감리 단계를 건너뛰었다」고 말하는 것처럼
                         읽혔다(2026-08-13). 건너뛴 게 아니라 **누가 답했는지**가
                         화면에 없었던 것이다.
                    */}
                    <div className="flex flex-col gap-4">
                      {displayGate ? (
                        <AuditGate
                          gate={displayGate}
                          runId={run!.run_id}
                          submitRef={gateSubmitRef}
                          onReadyChange={setIsGateReady}
                          onProgressChange={handleProgressChange}
                          readOnly={!gate || run?.status !== "awaiting_hitl"}
                        />
                      ) : (
                        <GateAbsentNotice doc={doc} auto={!!run?.auto_approve} />
                      )}
                    </div>
                  </div>
                )}
                {step === 3 && (
                  isProcessing ? (
                    <Processing />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-32 gap-6 bg-white rounded-2xl animate-in fade-in zoom-in-95 duration-300">
                      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      <div className="text-center">
                        <h3 className="text-[20px] font-bold text-green-700 mb-2">데이터 처리가 모두 완료되었습니다!</h3>
                        <p className="text-[15px] text-gray-500">아래 <strong>[다음 단계]</strong> 버튼을 눌러 상세 사유를 확인해 주세요.</p>
                      </div>
                    </div>
                  )
                )}
                {step === 4 && (
                  <div className="flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-300">
                    <div className="flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        </div>
                        <div className="flex items-baseline gap-3">
                          <h2 className="text-[1.25rem] font-bold text-gray-900 tracking-tight">금지 구역 선정 배경</h2>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1">
                      <ExclusionContent />
                    </div>
                  </div>
                )}
                {step === 5 && (
                  <div className="animate-in fade-in zoom-in-95 duration-300">
                    <Body doc={doc} hideTarget hideFlags={false} />
                  </div>
                )}
              </>
            )}
          </ArtifactView>
          )}
        </div>

        {/* 바닥 내비게이션 바 */}
        <div className="flex items-center justify-between px-8 py-5 border-t border-gray-100 bg-white shrink-0">
          <button 
             onClick={() => setStep(step - 1)}
             disabled={step === 1}
             className="px-6 py-2.5 rounded-xl font-bold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-30 transition-colors"
          >
            <div className="flex items-center gap-2 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              이전 단계
            </div>
          </button>
          {step === 5 ? (
            <button 
               onClick={() => {
                 if (run?.run_id) {
                   window.localStorage.setItem(`unlocked_weight_${run.run_id}`, "true");
                   window.dispatchEvent(new Event("storage"));
                 }
                 router.push("/weights");
               }}
               className="px-8 py-2.5 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 transition-colors shadow-md shadow-green-200"
            >
              <div className="flex items-center gap-2 text-sm">
                중요도로 넘어가기
              </div>
            </button>
          ) : (
            <button
               onClick={handleNext}
               disabled={nextBlockedByPending || (step === 2 && displayGate && gate && (!isGateReady || run?.status !== "awaiting_hitl")) || isSubmittingGate || (step === 3 && isProcessing)}
               className="px-8 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-md shadow-blue-200 disabled:bg-gray-300 disabled:shadow-none"
            >
              <div className="flex items-center gap-2 text-sm">
                {nextBlockedByPending || (step === 3 && isProcessing) ? "데이터 처리 중..." : "다음 단계"}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </button>
          )}
        </div>
      </div>
    </PageBody>
  );
}

/**
 * 「데이터 처리 중」 대기 화면. **이 화면에 원래 있던 STEP3 화면 그대로다.**
 *
 * 두 자리에서 쓴다 — ⓐ STEP3(게이트A 제출 후 STEP2~3 이 도는 동안) ⓑ 감리 산출물
 * (`reviewed.json`)이 아직 없는 동안. 같은 「기다리는 중」인데 화면이 둘이면 하나는
 * 반드시 낡는다. 그래서 사본을 만들지 않고 **한 곳에서 그린다** — 다른 건 **문구뿐**
 * 이라 문구만 주입받는다(스피너·여백을 각자 갖게 두면 둘이 갈린다).
 */
function Processing({ title, sub }: { title?: string; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-6 bg-white rounded-2xl animate-in fade-in zoom-in-95 duration-300">
      <div className="w-16 h-16 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
      <div className="text-center">
        <h3 className="text-[20px] font-bold text-blue-900 mb-2">
          {title ?? "AI가 다음 분석을 위해 열심히 데이터를 처리하고 있습니다..."}
        </h3>
        <div className="text-[15px] text-gray-500">
          {sub ?? "우측의 실시간 분석 모니터링 창을 통해 진행 상황을 확인하실 수 있습니다."}
        </div>
      </div>
    </div>
  );
}

/**
 * 감리(STEP1) 를 기다리는 동안의 화면. STEP2「규칙 확인」이 읽는 산출물이
 * `reviewed.json` 이고, `full` 은 여기가 실측 **56~239초**다.
 *
 * 🔴 STEP3 의 일반 대기(`Processing` 기본 문구)와 **다른 화면인 이유**는 기다리는
 *    대상이 달라서다. 여기는 감리 한 건이라 길이를 추정할 근거(데이터셋 수·용량)가
 *    있고, STEP3 는 그런 근거가 없다. 한 화면으로 합치면 근거 없는 쪽에도 숫자를
 *    지어내게 된다.
 *
 * 🔴 예상시간은 **개략치**이고 근거를 같이 적는다 — 산출식과 실측 앵커는
 *    `useAuditEta.ts` 에 있다. 숫자만 띄우면 약속으로 읽히고, 넘겼을 때 화면이
 *    거짓말을 한다(원칙 4). 그래서 ⓐ「예상」이라고 쓰고 ⓑ 근거(데이터셋 수·용량)를
 *    보이고 ⓒ **경과 시간**을 같이 센다 — 경과는 추정이 아니라 실측이라, 예상을
 *    넘기면 넘겼다고 말할 수 있다.
 */
function AuditProcessing({ run }: { run: RunDoc | null }) {
  const eta = useAuditEta(run?.domain);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const startedMs = run?.started_at ? Date.parse(run.started_at) : NaN;
  const elapsed = Number.isFinite(startedMs) ? Math.max(0, Math.round((now - startedMs) / 1000)) : null;
  const over = eta.seconds !== null && elapsed !== null && elapsed > eta.seconds;

  return (
    <Processing
      title="AI가 열심히 데이터를 확인하고 있습니다."
      sub={
        <div className="flex flex-col items-center gap-2">
          <p>
            {run?.mode === "full" ? "Full 모드는" : "이 단계는"} 보다 정확한 결과값을 위해 시간이 걸립니다
            {eta.seconds !== null && (
              <>
                {" "}
                <span className="font-bold text-blue-700">(예상시간 {eta.seconds}초)</span>
              </>
            )}
          </p>
          <p className="text-[13px] text-gray-400">
            {eta.datasetCount !== null && eta.totalBytes !== null
              ? `예상 근거: 데이터셋 ${eta.datasetCount}개 · ${(eta.totalBytes / 1e6).toFixed(1)} MB`
              : `예상시간 산출 못 함${eta.reason ? ` — ${eta.reason}` : ""}`}
            {elapsed !== null && ` · 경과 ${elapsed}초`}
          </p>
          {over && (
            <p className="text-[13px] font-bold text-amber-600">
              예상시간을 넘겼습니다 — 아직 도는 중입니다(우측 모니터링 창에서 확인).
            </p>
          )}
        </div>
      }
    />
  );
}

/**
 * 게이트A 질문이 화면에 없을 때 **그 자리에 무엇이 있었는지**를 말한다.
 *
 * 두 갈래가 같은 「질문 없음」으로 보이지만 뜻이 다르다:
 *   ⓐ `auto` — 「고속 자동 분석」. 서버가 게이트를 세운 뒤 **AI 제안값으로 대신
 *      답했다.** 사람이 볼 기회가 없었던 것이지 감리를 건너뛴 게 아니다.
 *   ⓑ 그 외 — 이미 사람이 답했거나(재방문), 물을 것이 없었다.
 *
 * 🔴 어느 쪽이든 **빈 화면으로 두지 않는다.** 자동 승인된 값은 배제 반경이라
 *    후보지 전체를 좌우한다 — 「누가 정했는지」가 안 보이면 산출물이 거짓말을
 *    하는 것과 같다(원칙 4).
 */
function GateAbsentNotice({ doc, auto }: { doc: ReviewedDoc; auto: boolean }) {
  // 자동 승인의 흔적은 러너가 값마다 남긴 `source` 다(`llm_auto_approved`).
  // run 단위 플래그(`auto_approve`)만 믿지 않고 **값에 적힌 출처**를 같이 본다 —
  // 둘이 어긋나면 그건 알아야 할 사실이다.
  const approved = doc.results.flatMap((r) =>
    r.roles
      .filter((ro) => ro.role === "hard_exclusion" && ro.source === "llm_auto_approved")
      .map((ro) => ({ dataset_id: r.dataset_id, facility: ro.facility_type, radius: ro.배제반경_m })),
  );

  // 🔴 run 플래그가 없어도 값에 출처가 있으면 자동으로 친다. `auto_approve` 는
  //    2026-08-13 에 생긴 키라 **그 전 run 의 `status.json` 에는 아예 없다** —
  //    플래그만 보면 옛 자동 run 이 「물을 것이 없었다」로 둔갑한다.
  if (!auto && approved.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-10 text-center">
        <p className="text-[15px] font-semibold text-gray-700">검토가 필요한 규칙이 없습니다.</p>
        <p className="mt-1 text-[13px] text-gray-500">
          이미 확정된 규칙은 위 <strong>[선정 대상]</strong> 화면과 다음 단계에서 확인할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/60 px-6 py-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-violet-100 p-2 text-violet-600">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>
        </div>
        <div className="flex-1">
          <h3 className="text-[16px] font-bold text-violet-900">고속 자동 분석 — AI 제안값으로 자동 승인되었습니다</h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-violet-800/80">
            감리 단계를 건너뛴 것이 아닙니다. 이 실행은 규칙 확인 게이트에서 멈춘 뒤,
            사람 대신 <strong>AI 제안값을 그대로 확정</strong>하고 진행했습니다.
            직접 값을 정하려면 처음 화면에서 <strong>맞춤형 대화 분석</strong>으로 다시 실행하세요.
          </p>

          {approved.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1.5">
              {approved.map((a, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-[13px] border border-violet-100">
                  <span className="font-mono text-[11px] text-violet-500">{a.dataset_id}</span>
                  <span className="font-semibold text-gray-800">{a.facility ?? "—"}</span>
                  <span className="ml-auto text-gray-600">
                    설치 금지 반경 {a.radius == null ? "면 전체" : meters(a.radius)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            // 🔴 「자동으로 돌렸는데 자동 승인된 값이 하나도 없다」는 그 자체가 정보다.
            //    빈 목록을 조용히 감추면 「0건」과 「못 읽었다」가 구분되지 않는다.
            <p className="mt-4 rounded-lg bg-white/70 px-3 py-2 text-[13px] text-gray-600 border border-violet-100">
              자동 승인 표시(<code>llm_auto_approved</code>)가 붙은 규칙이 없습니다 — 이 실행에서는
              물을 것이 없었거나, 값의 출처가 다르게 기록됐습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 선정 대상 표. **`Body` 에서 떼어냈다** — 값의 출처가 둘이기 때문이다.
 *
 * 같은 값이 두 산출물에 있고 나오는 시점이 다르다: `facility.json` 은 STEP 0.5
 * 직후(실측 ~15초), `reviewed.facility_inference` 는 감리 뒤(실측 ~240초).
 * 이 표는 감리 결과를 한 글자도 안 쓰므로 앞의 것으로 먼저 그린다.
 *
 * 🔴 여기엔 「감리가 아직 도는 중」 안내를 **안 적는다.** 이 단계는 값이 이미
 *    확정이고 [다음 단계] 도 열려 있다 — 기다림은 STEP2「규칙 확인」에서
 *    `Processing`(스피너 + 예상시간)이 맡는다. 두 곳에서 같은 말을 하면 한쪽은
 *    반드시 낡는다.
 */
function TargetSection({ fi }: { fi: FacilityInference }) {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div className="flex items-baseline gap-3">
              <h2 className="text-[1.25rem] font-bold text-gray-900 tracking-tight">선정 대상</h2>
              <p className="text-[14px] text-gray-500">AI가 분석한 결과입니다 맞는 지 확인해주세요.</p>
            </div>
          </div>

          {/**
            * 🔴 칸은 **넷**이다. 마지막 「분석 주체」를 빼면 이 표는 시설·지역·입력을
            *    단정해 놓고 **그게 AI 추론인지 사람이 확정한 것인지를 안 말한다**
            *    (원칙 4). 「AI 자동 추론됨」은 아직 사람이 안 본 값이라는 뜻이고,
            *    그 구분이 없으면 화면 위쪽 안내문("AI가 분석한 결과입니다 맞는 지
            *    확인해주세요")이 확정 후에도 그대로 남아 무엇을 확인하라는지 흐려진다.
            */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-x divide-gray-100">
            <KV icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/><path d="M12 3v6"/></svg>} k="시설" v={fi.facility} />
            <KV icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>} k="지역" v={fi.region} />
            <KV icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>} k="입력" v={fi.source_input} />
            <KV
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
              k="분석 주체"
              v={fi.confirmed ? "사람이 직접 확정함" : "AI 자동 추론됨"}
              tone={fi.confirmed ? "ok" : "info"}
            />
          </div>



          {/**
            * ⚠ **이 배지가 한 번도 안 뜨는 게 정상처럼 보일 수 있다 — 백엔드 별건이다.**
            *    2026-08-24 백엔드 실측: 데이터를 전부 흡연으로 두고 입력만 EV 로 줘도
            *    `mismatch: false` 였다. STEP0.5 프롬프트 쪽 문제이고 원인 미규명이다.
            *    **프런트 코드 결함이 아니니 여기를 고치려 들지 말 것.**
            *
            * 그럼에도 배지를 **떼지 않는다.** ⓐ 틀린 값을 띄우는 게 아니라 안 띄우는
            * 것이라 지금 화면은 배지가 없던 시절과 같고, ⓑ 떼면 백엔드가 고친 뒤
            * 되살리는 걸 잊는다. ⓒ 「이 검사는 신뢰할 수 없음」을 화면에 항상 띄우면
            * 정상일 때도 흐려진다.
            *
            * 오독 위험이 작은 근거: 위 4칸 표의 「분석 주체」가 이미 `confirmed` 로
            * 「AI 자동 추론됨 / 사람이 직접 확정함」을 말한다. 이 화면의 주된 요청은
            * 「AI 추론이니 사람이 확인하라」(게이트A)이고 배지는 그 위에 얹는 힌트다.
            */}
          {fi.mismatch && (
            <div className="mt-2 flex gap-3 p-4 rounded-xl border border-orange-200 bg-orange-50 text-orange-800">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <div className="text-sm">
                <span className="font-bold">입력과 데이터 불일치:</span> {fi.mismatch_reason}
              </div>
            </div>
          )}

      </section>
    </div>
  );
}

function Body({ doc, hideFlags, hideTarget }: { doc: ReviewedDoc, hideFlags?: boolean, hideTarget?: boolean }) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-10">
      {!hideTarget && <TargetSection fi={doc.facility_inference} />}

      {/* ── 데이터셋 판정 ── */}
      {!hideFlags && (
        <section className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            </div>
            <div className="flex items-baseline gap-3">
              <h2 className="text-[1.25rem] font-bold text-gray-900 tracking-tight">데이터 역할 확인</h2>
              <p className="text-[14px] text-gray-500">각 카테고리를 클릭해서 AI가 분석에 사용할 데이터의 역할을 판정한 결과를 확인해 주세요.</p>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col gap-4">
            {(() => {
              const categories = [
                { id: 'positive_factor', label: '가점 요인', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900', icon: 'bg-blue-400', ring: 'ring-blue-100' },
                { id: 'negative_factor', label: '감점 요인', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-900', icon: 'bg-orange-400', ring: 'ring-orange-100' },
                { id: 'hard_exclusion', label: '설치 금지', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900', icon: 'bg-red-400', ring: 'ring-red-100' },
                { id: 'reference_only', label: '참조만', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-900', icon: 'bg-gray-400', ring: 'ring-gray-100' },
              ];

              const categorizedResults = categories.map(cat => ({
                ...cat,
                items: doc.results.filter(r => r.roles.some(role => role.role === cat.id)).map(r => ({
                  dataset: r,
                  role: r.roles.find(role => role.role === cat.id)!
                }))
              })).filter(cat => cat.items.length > 0);

              return categorizedResults.map(cat => (
                <div key={cat.id} className="flex flex-col">
                  <button
                    onClick={() => setOpenCategory(openCategory === cat.id ? null : cat.id)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors outline-none focus:ring-2 ${
                      openCategory === cat.id 
                        ? `${cat.bg} ${cat.border} ${cat.ring}` 
                        : `bg-white border-gray-200 hover:bg-gray-50`
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <h3 className={`font-bold text-[15px] ${openCategory === cat.id ? cat.text : 'text-gray-800'}`}>
                        {cat.label}
                      </h3>
                      <span className="text-xs font-medium text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 shadow-sm">
                        {cat.items.length}개
                      </span>
                    </div>
                    <svg className={`w-5 h-5 text-gray-400 transition-transform ${openCategory === cat.id ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </button>
                  
                  {openCategory === cat.id && (
                    <div className="p-4 mt-2 bg-gray-50/50 border border-gray-100 rounded-xl flex flex-col gap-3 animate-in fade-in slide-in-from-top-2">
                      {cat.items.map((item, idx) => {
                        const excl = item.role.role === "hard_exclusion";
                        return (
                          <div key={item.dataset.dataset_id + idx} className="flex items-start gap-3 p-4 bg-white rounded-lg border border-gray-100 shadow-sm">
                            <div className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${cat.icon}`} />
                            <div className="flex-1">
                              <p className="text-[13.5px] text-gray-800 leading-relaxed">
                                {item.dataset.summary.replace(/^이 데이터는\s*/, "")}
                              </p>
                            </div>
                            {excl && (
                              <div className="shrink-0 text-[12px] font-mono text-gray-500 bg-gray-50 px-2.5 py-1.5 rounded border border-gray-100">
                                {item.role.배제반경_m != null ? `반경 ${meters(item.role.배제반경_m)}` : '해당사항 없음'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ));
            })()}
          </div>
        </section>
      )}
    </div>
  );
}

function RoleChip({ role }: { role: ReviewedRole }) {
  const excl = role.role === "hard_exclusion";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide border shadow-sm ${
        excl 
          ? "bg-red-50 text-red-700 border-red-200" 
          : "bg-white text-gray-700 border-gray-200"
      }`}
      title={role.rationale}
    >
      {ROLE_LABEL[role.role] ?? role.role}
      {excl && role.배제반경_m != null && <span className="opacity-70 font-mono ml-0.5">· {meters(role.배제반경_m)}</span>}
      {!excl && typeof role.weight === "number" && <span className="opacity-70 font-mono ml-0.5">· W:{role.weight}</span>}
    </span>
  );
}

function KV({ icon, k, v, tone }: { icon: React.ReactNode, k: string; v: string; tone?: "ok" | "warn" | "info" }) {
  return (
    <div className="flex flex-col gap-1.5 p-6 bg-white hover:bg-gray-50/50 transition-colors">
      <div className="flex items-center gap-2 text-gray-400">
        <div className="text-gray-300">{icon}</div>
        <dt className="text-xs font-semibold">{k}</dt>
      </div>
      <dd className={`text-[15px] font-bold ${tone === "warn" ? "text-orange-600" : tone === "ok" ? "text-green-600" : tone === "info" ? "text-blue-600" : "text-gray-900"} pl-7`}>
        {v}
      </dd>
    </div>
  );
}

function StepIcon({ current, stepNum, label }: { current: number; stepNum: number; label: string }) {
  const isActive = current === stepNum;
  const isPast = current > stepNum;
  
  return (
    <div className={`flex items-center gap-3 transition-opacity ${isActive ? 'opacity-100' : 'opacity-40'}`}>
      <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[13px] font-bold shadow-sm ${
        isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'
      }`}>
        {isPast ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> : stepNum}
      </div>
      <span className={`text-[14px] font-bold ${isActive ? 'text-blue-900' : 'text-gray-500'}`}>
        {label}
      </span>
    </div>
  );
}
