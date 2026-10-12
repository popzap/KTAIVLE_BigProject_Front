"use client";

/**
 * DEMO 모드 띠 — 「실제 실행 기록 재생」.
 * ====================================
 * 🔴 **전 화면 공통이다.** 데모에서 보이는 값은 전부 녹화한 실제 응답이지만
 *    지금 계산한 것은 아니다. 어느 화면에서든 그 사실과 녹화 시점이 보여야
 *    「실시간 분석 결과」로 읽히지 않는다(`ReviewBanner` 와 같은 이유).
 *
 * 🔴 **기록된 경로를 같이 적는다.** 재생은 녹화와 같은 입력일 때만 된다
 *    (`demo.ts` — 다르면 「기록에 없는 동작」). 어디로 가야 하는지가 띠에 없으면
 *    막혔을 때 사람은 「고장났다」고 읽는다.
 */
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DEMO, DEMO_RUN, loadDemoManifest, restartDemo } from "@/lib/omnisite/demo";

/**
 * 녹화마다 사람이 밟은 경로. manifest 에는 요청만 있고 「어떤 버튼을 골랐나」는
 * 없어서 녹화한 사람이 적는다(근거: 그 녹화의 README 「화면 5 입력값」).
 * 없는 run 이면 경로 문구를 안 띄운다 — 지어내지 않는다.
 */
const GUIDE: Record<string, string> = {
  r_20261012_001: "프리셋 흡연 → 고속 자동 분석 → 1순위 후보(422 대) → 대립 토론 · 다자간 토론(상위 3명) → 보고서",
};

/** `2026-10-12T19:44:36+09:00` → `2026-10-12 19:44` (녹화 기록의 표기 그대로 자른다) */
function shortStamp(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : iso;
}

export function DemoBanner() {
  const [recordedAt, setRecordedAt] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!DEMO) return;
    loadDemoManifest()
      .then((m) => setRecordedAt(m.recorded_at))
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)));
  }, []);

  if (!DEMO) return null;

  return (
    <div className="shrink-0 border-b border-indigo-200 bg-indigo-50/95">
      <div className="mx-auto flex min-h-9 max-w-[1600px] items-center gap-3 px-5 py-1.5 text-[13px] text-indigo-950">
        <span className="shrink-0 font-semibold">실제 실행 기록 재생</span>
        <span className="text-indigo-900/40">—</span>
        <span className="truncate">
          {failure ?? (
            <>
              {recordedAt ? `${shortStamp(recordedAt)} 에 실제로 돌린 실행(${DEMO_RUN})의 요청·응답을 같은 속도로 재생합니다. 서버는 없습니다.` : `${DEMO_RUN} 기록을 읽는 중…`}
              {GUIDE[DEMO_RUN] && (
                <span className="ml-2 text-indigo-900/70">기록된 경로: {GUIDE[DEMO_RUN]}</span>
              )}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={restartDemo}
          className="ml-auto shrink-0 rounded-md border border-indigo-300 px-2.5 py-1 text-[12px] font-medium text-indigo-900 transition hover:bg-indigo-100"
          title="브라우저에 남은 재생 상태를 지우고 화면 1부터 다시 봅니다."
        >
          처음부터 다시 보기
        </button>
      </div>
    </div>
  );
}

/** 데모에서 막는 화면. 녹화 밖이라 재생할 응답이 없다. `name` 은 조사까지 붙인 주어다. */
const BLOCKED: { prefix: string; name: string }[] = [
  { prefix: "/posts", name: "게시판은" },
  { prefix: "/mypage", name: "마이페이지는" },
  { prefix: "/hearing-pdf", name: "표본 보고서(HWPX)는" },
];

export function demoBlockedName(pathname: string): string | null {
  if (!DEMO) return null;
  return BLOCKED.find((b) => pathname === b.prefix || pathname.startsWith(`${b.prefix}/`))?.name ?? null;
}

export function DemoBlocked({ name }: { name: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h2 className="mb-2 text-lg font-bold text-gray-800">{name} 데모에서 쓰지 않습니다</h2>
        <p className="text-sm leading-relaxed text-gray-600">
          이 데모는 녹화한 실제 실행 한 건을 재생합니다. 이 화면은 그 실행에 포함되지 않아
          보여 줄 응답이 없습니다.
        </p>
      </div>
    </div>
  );
}

/** 레이아웃의 본문 자리. 데모에서 막는 화면이면 본문 대신 안내를 그린다. */
export function DemoGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const name = demoBlockedName(pathname);
  return name ? <DemoBlocked name={name} /> : <>{children}</>;
}
