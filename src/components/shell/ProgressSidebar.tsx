"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { gateScreen } from "@/lib/omnisite/gate";
import { useRun } from "@/lib/omnisite/RunProvider";
import { computeProgress, formatDuration, loadBaseline } from "@/lib/omnisite/progress";
import { percent } from "@/lib/omnisite/format";
import type { RunDoc, RunStep } from "@/lib/omnisite/types";

export function ProgressSidebar() {
  const { run, restoring, runningElapsedSec, refresh } = useRun();
  const baseline = loadBaseline();
  const pathname = usePathname();

  if (
    pathname?.startsWith("/sites") ||
    pathname?.startsWith("/hearing") ||
    pathname?.startsWith("/dynamic-hearing") ||
    pathname?.startsWith("/report")
  ) {
    return null;
  }

  /**
   * 🔴 **run 이 없으면 통을 아예 안 그린다**(2026-08-15 사람 지시). 예전엔 420px
   *    패널을 띄워놓고 그 안에 「진행 중인 분석이 없습니다」를 적었다 — 화면1 에
   *    처음 들어온 사람은 아직 아무것도 시작하지 않았는데 **모니터가 먼저 켜져
   *    있고 「없다」고 말하는** 화면을 본다. 감시할 대상이 생긴 뒤에 켜지는 게
   *    맞다.
   *
   * 🔴 **`restoring` 도 같이 막는다.** 이게 진짜 이유다 — `restoring` 은 초깃값이
   *    `true` 라 **서버 프리렌더에도 참**이고, 그래서 브라우저가 받는 HTML 에 이미
   *    420px 패널이 들어 있다. `!run` 만 막으면 패널이 **한 번 그려졌다가 사라져**
   *    본문이 420px 옆으로 튄다. 저장된 run_id 가 없을 때 `restoring` 은
   *    마이크로태스크 한 번이라(`RunProvider.tsx:193`) 여기서 막으면 깜빡임이
   *    아예 없다.
   *
   * ⚠ 저장된 run 을 복원하는 경우에는 `fetchRun` 왕복만큼 늦게 나타난다. 그건
   *   **맞는 순서**다 — 있는지 모르는 것을 미리 그려놓고 지우는 것보다 낫다.
   * ⚠ 그래서 「없음」·「복원 중」 두 상태는 이 컴포넌트에 **없다.** 없는 것을
   *   그리는 자리를 다시 만들지 말 것.
   */
  if (restoring || !run) return null;

  return (
    <aside className="relative w-[420px] bg-gray-50/80 backdrop-blur-xl border-l border-gray-200 flex flex-col h-full shadow-sm shrink-0">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white/50">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-800">실시간 분석 모니터링</h2>
          {(run.status === "running" || run.status === "queued") && (
             <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          )}
        </div>
      </div>

      <div className="flex-1 custom-scrollbar overflow-y-auto p-5">
        <SidebarContent run={run} baseline={baseline} runningElapsedSec={runningElapsedSec} refresh={refresh} />
      </div>
    </aside>
  );
}

function SidebarContent({ run, baseline, runningElapsedSec, refresh }: { run: RunDoc, baseline: any, runningElapsedSec: number, refresh: () => void }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (run.status === "awaiting_hitl") {
      const interval = setInterval(() => setTick((t) => t + 1), 500);
      return () => clearInterval(interval);
    }
  }, [run.status]);

  const p = computeProgress(run, baseline, runningElapsedSec);
  const live = run.status === "queued" || run.status === "running";

  return (
    <div className="flex flex-col gap-5">
      {/* ── 요약 메타 정보 ── */}
      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
        <dl className="grid grid-cols-2 gap-y-1">
          <div>
            <dt className="text-sm font-medium text-gray-500 mb-1">주제</dt>
            {/*
              🔴 **`run.domain` 은 주제가 아니라 저장 폴더 이름이다.** 업로드 갈래에서
                 같은 이름이 이미 있으면 백엔드가 `EV 충전소_2` 로 폴더를 새로 판다
                 (`page.tsx` 의 `uploadedDomain.actual`). 그걸 그대로 「주제」에 찍으면
                 사람이 친 적 없는 이름이 분석 주제로 둔갑한다 — 화면1 은 이미
                 「바뀐 것은 저장 폴더지 분석 주제가 아니다」라고 적어두고 있어서
                 두 화면이 서로 다른 말을 하게 된다(2026-08-24 사람 지시).

              ⚠ 폴더 이름을 **감추지는 않는다.** 꼬리를 뗀 이름만 남기면 결과가
                어느 폴더에서 나왔는지 화면 어디에도 안 남는다(원칙 4). 달라질 때만
                아래에 작게 적는다.
              ⚠ 사이드바는 사람이 친 원래 이름을 모른다 — `RunDoc` 에 그 값이 없다.
                그래서 꼬리를 **문자열에서 떼는 수밖에 없고**, 사람이 진짜로
                `EV 충전소_2` 라고 친 경우엔 주제가 한 칸 틀리게 적힌다. 그 경우에도
                아래 「저장 폴더」 줄에 실제 값이 남으므로 틀린 채로 묻히지는 않는다.
            */}
            <dd className="text-lg font-bold text-gray-800">{topicOf(run.domain)}</dd>
            {topicOf(run.domain) !== run.domain && (
              <dd className="text-[11px] text-gray-400 mt-0.5">
                저장 폴더 <code className="font-mono">{run.domain}</code>
              </dd>
            )}
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500 mb-1">모드</dt>
            {/*
              🔴 **축이 둘이다.** 데이터 갈래(`mode`: 프리셋 hitl ↔ 업로드 full)와
                 분석 갈래(`auto_approve`: 맞춤형 ↔ 고속)는 서로 무관하게 조합된다.
                 예전엔 `mode === "hitl" ? "대화형" : "자동"` 한 줄이라 **게이트에
                 멈춰 선 맞춤형 full run 도 「자동」**이라고 적었다 — 그래서 화면이
                 「감리를 건너뛰었다」고 말하는 것처럼 읽혔다(2026-08-13).
            */}
            <dd className="text-lg font-bold text-gray-800">{run.mode === "hitl" ? "프리셋" : "업로드"}</dd>
            {/*
              ⚠ 키가 **없는** 옛 run 은 아무 말도 안 한다. `undefined` 를 `false` 로
                접으면 자동으로 돌린 옛 run 이 「맞춤형」으로 둔갑한다 — 모르는 것을
                모른다고 두는 편이 낫다(원칙 4).
            */}
            {run.auto_approve !== undefined && (
              <dd className="text-xs font-semibold text-gray-500 mt-0.5">
                {run.auto_approve ? "고속 자동 분석" : "맞춤형 대화 분석"}
              </dd>
            )}
          </div>
        </dl>
      </div>

      {/* ── 진행률 ── */}
      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-gray-800">{statusLabel(run)}</span>
          <span className="text-lg font-black text-gray-900 tracking-tight">{p.ratio === null ? "—%" : percent(p.ratio, 0)}</span>
        </div>
        
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-[width] duration-500 rounded-full ${run.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: p.ratio === null ? "0%" : `${p.ratio * 100}%` }}
          />
        </div>
        
        <div className="mt-3 flex justify-between text-[11px] text-gray-500">
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            남은 시간 {formatDuration(p.remainSec)}
          </span>
          <span>{p.doneCount} / {p.totalCount} 완료</span>
        </div>
      </div>

      {/* ── 사람 확인 대기 (게이트) ── */}
      {run.status === "awaiting_hitl" && <GateBlock run={run} onRefresh={refresh} />}

      {/* ── 단계 리스트 ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-xs font-bold text-gray-700">작업 단계</h3>
        </div>
        <ol className="p-2 flex flex-col gap-1 max-h-[200px] overflow-y-auto custom-scrollbar">
          {run.steps.map((s) => (
            <StepRow key={s.id} step={s} baselineSec={baseline?.[s.id] ?? null} />
          ))}
        </ol>
      </div>

      
      {/* ── 완료 후 다음 스텝 안내 ── */}
      {run.status === "succeeded" && (
         <div className="rounded-xl border-2 border-green-400 bg-green-50 p-6 flex flex-col items-center text-center shadow-sm animate-in fade-in zoom-in-95">
           <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-3">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-600"><path d="M20 6 9 17l-5-5"/></svg>
           </div>
           <h3 className="text-[13px] font-bold text-green-800">분석이 완료되었습니다!</h3>
         </div>
      )}
    </div>
  );
}

/**
 * 저장 폴더 이름에서 겹침 회피 꼬리(`_2`, `_3` …)를 떼어 주제로 되돌린다.
 *
 * ⚠ `_숫자` 로 **끝날 때만** 뗀다. `_` 를 통째로 자르면 `공공_와이파이` 같은
 *   이름이 「공공」이 된다.
 */
function topicOf(domain: string): string {
  return domain.replace(/_\d+$/, "");
}

function GateBlock({ run, onRefresh }: { run: RunDoc; onRefresh: () => void }) {
  const pathname = usePathname();
  const gate = run.gate;
  const target = gate ? gateScreen(gate.id) : null;

  if (!gate) {
    return null;
  }

  const isOnTargetScreen = target && pathname?.startsWith(target.path);

  return (
    <div className={`rounded-xl border-2 p-4 shadow-sm relative overflow-hidden animate-in fade-in slide-in-from-right-4 ${
      isOnTargetScreen ? "border-yellow-400 bg-yellow-50" : "border-indigo-300 bg-indigo-50"
    }`}>
      <div className="absolute top-0 right-0 p-3 opacity-10">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      
      <h3 className={`text-[13px] font-extrabold mb-1 flex items-center gap-1.5 ${
        isOnTargetScreen ? "text-yellow-900" : "text-indigo-900"
      }`}>
        <span className="relative flex h-2.5 w-2.5">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
            isOnTargetScreen ? "bg-yellow-500" : "bg-indigo-400"
          }`}></span>
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
            isOnTargetScreen ? "bg-yellow-600" : "bg-indigo-500"
          }`}></span>
        </span>
        {isOnTargetScreen ? "사람의 확인이 필요합니다" : `다음 단계(${target?.name || "알 수 없음"}) 대기 중`}
      </h3>
      <p className={`text-[11px] mb-3 leading-relaxed ${
        isOnTargetScreen ? "text-yellow-800/80" : "text-indigo-800/80"
      }`}>
        {isOnTargetScreen 
          ? "다음 단계로 파이프라인을 진행하기 앞서, AI가 도출한 중간 결과에 대해 담당자의 최종 확인 및 승인이 필요하여 분석이 일시 정지되었습니다."
          : `파이프라인이 정상적으로 일시 정지되었습니다! 오류가 아니니 안심하세요. 현재 단계의 상세 결과를 충분히 검토하신 후, 화면 안내에 따라 다음 단계로 넘어가시면 됩니다.`}
      </p>
    </div>
  );
}

const STEP_NAME_MAP: Record<string, string> = {
  "정제": "데이터 정리",
  "후보 필지 생성": "후보 지역 생성",
  "가중치 산정": "중요도 산정",
  "후보점 생성": "후보 위치 선정",
  "점수화·배제 적용": "점수 계산",
  "위치 선정": "위치 확정",
  "감리 규칙 DB 적재 (토론 근거)": "토론 근거 생성",
  "후보점 DB 적재 (화면5 목록)": "후보 위치 등록",
};

function StepRow({ step, baselineSec }: { step: RunStep; baselineSec: number | null }) {
  const isRunning = step.status === "running";
  const isDone = step.status === "done";
  const isFailed = step.status === "failed";
  
  const displayLabel = STEP_NAME_MAP[step.label] || step.label;

  return (
    <li className={`flex items-center justify-between p-2 rounded-lg text-[11px] transition-colors ${
      isRunning ? 'bg-blue-50 border border-blue-100' : isFailed ? 'bg-red-50 border border-red-100' : 'hover:bg-gray-50'
    }`}>
      <div className="flex items-center gap-2 truncate">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? 'bg-blue-500 animate-pulse' : isDone ? 'bg-green-500' : isFailed ? 'bg-red-500' : 'bg-gray-300'}`} />
        <span className={`truncate ${isRunning ? 'font-bold text-blue-900' : isDone ? 'text-gray-700' : 'text-gray-500'}`}>{displayLabel}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-gray-400 font-mono">
          {typeof step.sec === "number" ? `${step.sec.toFixed(1)}s` : isDone ? "0s" : baselineSec !== null ? `~${baselineSec.toFixed(0)}s` : ""}
        </span>
      </div>
    </li>
  );
}

function statusLabel(run: RunDoc): string {
  if (run.status === "awaiting_hitl" && run.gate) {
    if (run.gate.id === "audit") return "데이터 분석 진행 중";
    // ⚠ 어휘는 아래 `STEP_NAME_MAP` 과 맞춘다 — 같은 패널 안에서 단계 이름은
    //    「중요도 산정」인데 이 줄만 「가중치」면 두 낱말이 같은 것을 가리키는지
    //    화면만 보고는 알 수 없다. (앱의 다른 화면은 도메인 용어 「가중치」 그대로다)
    if (run.gate.id === "weight") return "중요도 설정 진행 중";
  }
  return {
    queued: "대기 중",
    running: "데이터 처리 중",
    awaiting_hitl: "일시 정지됨",
    succeeded: "분석 완료",
    failed: "분석 실패",
  }[run.status] ?? run.status;
}
