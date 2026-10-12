"use client";

/**
 * 상단 셸 — 로고 · 6단계 내비 · 실행 상태.
 *
 * 내비에는 **화면 번호**만 나온다. STEP 번호는 여기 절대 안 들어온다.
 * 완료 표시(✓)의 기준은 "그 화면이 읽을 산출물이 run 에 있는가" 다 —
 * 사용자가 방문했는지가 아니라 데이터가 있는지로 판단한다.
 *
 * 🔴 **화면 5 만 예외다.** 다른 화면은 `run.artifacts` 하나로 판정하는데 토론은
 *    거기 없다 — **서버 DB 에 남고**(2026-08-11 경로가 열렸다) 물으려면 조인 키인
 *    `run.loaded.run_id` 가 있어야 한다. 그래서 아래 `hearingDone` 을 따로 구해
 *    넘긴다. 판정이 어디서 왔는지(`source`)까지 같이 온다.
 */
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV_SCREENS, screenOf, isScreenReady, isScreenAllowed } from "@/lib/omnisite/screens";
import { useRun } from "@/lib/omnisite/RunProvider";
import { isHearingDoneFor } from "@/lib/omnisite/hearingResult";
import { useHearingDone } from "@/lib/omnisite/hearings";
import type { ArtifactName, RunDoc } from "@/lib/omnisite/types";
import { AuthModal } from "./AuthModal";
import { DEMO } from "@/lib/omnisite/demo";
import { SessionBadge } from "./SessionBadge";
import { getAuthUser, clearAuth, UserResponse } from "@/lib/omnisite/auth";
import { cancelRun } from "@/lib/omnisite/pipeline";
import { fetchDomains, resetDomain } from "@/lib/omnisite/upload";
import { ApiError, describeFailure } from "@/lib/omnisite/client";
import { ResetConfirmModal, type ResetTargets } from "./ResetConfirmModal";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { run, reset, reviewing } = useRun();
  const current = screenOf(pathname);
  const live = run?.status === "queued" || run?.status === "running";

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [user, setUser] = useState<UserResponse | null>(null);
  const [unlockedWeight, setUnlockedWeight] = useState(false);
  const [highestIndex, setHighestIndex] = useState(0);

  /**
   * 화면 5 완료 여부. **서버가 본선, sessionStorage 가 폴백**이다(`useHearingDone`).
   * 둘 다 마운트 뒤에 구한다 — 로컬 기록은 서버 렌더 때 존재하지 않아 렌더 중에
   * 읽으면 하이드레이션이 깨진다(2026-08-05 에 한 번 밟은 자리다).
   *
   * 🔴 폴백으로 넘기는 `isHearingDoneFor` 는 **이 탭 안에서만 유효**하다. 서버에
   *    못 물었을 때만(적재 칸 없는 fixture·hitl 실행, 404, 네트워크 실패) 쓰인다 —
   *    서버가 「0건」이라고 답하면 로컬을 보지 않는다.
   */
  const hearing = useHearingDone(isHearingDoneFor, pathname);
  const hearingDone = hearing.done;

  /**
   * 로그인 상태 동기화.
   *
   * 🔴 `setUser(getAuthUser())` 를 effect 본문에 **한 줄로 박지 않는다.** 그러면
   *    마운트 때 한 번만 읽고 끝이라, 다른 탭의 로그인/로그아웃(`storage`)도
   *    같은 탭의 로그아웃(`omnisite-auth-change`, `handleLogout` 이 직접 쏜다)도
   *    헤더에 안 닿는다. 같은 함수를 초기 1회 + 두 이벤트에 **같이** 건다.
   */
  useEffect(() => {
    const syncUser = () => {
      setUser(getAuthUser());
    };
    // 마운트 시 1회. 서버 프리렌더에는 localStorage 가 없어 렌더 중에 읽으면
    // 하이드레이션이 어긋난다 — 그래서 여기서 읽는다.
    syncUser();

    window.addEventListener("storage", syncUser);
    window.addEventListener("omnisite-auth-change", syncUser);

    return () => {
      window.removeEventListener("storage", syncUser);
      window.removeEventListener("omnisite-auth-change", syncUser);
    };
  }, [pathname]);

  /**
   * 순차 진행 잠금(데모 시연용) — `unlocked_weight_*` · `highest_nav_index_*`.
   *
   * 🔴 위 로그인 동기화와 **effect 를 합치지 않는다.** 의존 배열이 다르다
   *    (`[pathname]` ↔ `[run?.run_id, current]`) — 합치면 화면을 옮길 때마다
   *    `storage` 리스너를 떼었다 붙이거나, 반대로 run 이 바뀌어도 잠금이 안 따라온다.
   */
  useEffect(() => {
    const checkUnlock = () => {
      if (run?.run_id) {
        setUnlockedWeight(window.localStorage.getItem(`unlocked_weight_${run.run_id}`) === "true");
        
        // 프론트엔드 순차 진행 강제 락
        const storedKey = `highest_nav_index_${run.run_id}`;
        const stored = parseInt(window.localStorage.getItem(storedKey) || "0", 10);
        
        if (current) {
          const currentIndex = NAV_SCREENS.findIndex(s => s.no === current.no);
          if (currentIndex > stored) {
            window.localStorage.setItem(storedKey, currentIndex.toString());
            setHighestIndex(currentIndex);
          } else {
            setHighestIndex(stored);
          }
        } else {
          setHighestIndex(stored);
        }
      }
    };
    
    checkUnlock();
    window.addEventListener("storage", checkUnlock);
    return () => window.removeEventListener("storage", checkUnlock);
  }, [run?.run_id, current]);

  const handleLogout = () => {
    // 🔴 access·refresh·user 를 **같이** 지운다(`clearAuth`). 예전엔 access 와 user 만
    //    지웠는데, refresh 키가 생긴 뒤로는 그러면 죽은 재발급 토큰이 남아 다음
    //    로그인 세션과 섞인다.
    //    (PR #62 가 이 주석만 지우고 `clearAuth()` 호출은 그대로 뒀다 — 되살린다.
    //     핀을 왜 박았는지 적은 주석이 사라지면 다음 사람이 그 핀을 뺀다.)
    clearAuth();
    setUser(null);
    // 같은 탭에서는 `storage` 이벤트가 안 뜬다 — 헤더가 로그아웃을 즉시 반영하도록
    // 직접 쏜다(수신은 위 effect).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("omnisite-auth-change"));
    }
  };

  /**
   * 「데이터 초기화」 — **브라우저만 지우던 버튼에 서버 정리를 더했다**(2026-08-14).
   *
   * 세 가지를 이 순서로 한다. **순서가 곧 규칙이다.**
   *   ① `DELETE /runs/{id}`   진행 중인 run 을 취소한다(자식 프로세스까지 죽는다)
   *   ② `DELETE /upload/domains/{domain}`  그 도메인의 업로드를 통째로 지운다
   *   ③ `reset()`             브라우저 상태(run id·게이트·화면 잠금)를 지운다
   *
   * 🔴 ①이 ② 앞에 있어야 한다. 서버는 「진행 중인 run 이 있는 도메인」을 **409** 로
   *    막는데(그게 옳다 — 그 run 이 지금 읽고 있는 입력이다), 초기화를 누르는
   *    사람의 run 이 바로 그 run 인 경우가 대부분이다. 순서를 바꾸면 **정상 경로가
   *    거의 항상 409** 다.
   *
   * 🔴 **「run 초기화 = 업로드 삭제」는 사람이 정한 것이다**(2026-08-14 지시).
   *    유추가 아니다 — 화면 1 에서 올린 파일은 그 실행의 입력이고, 실행을 버리면
   *    입력도 같이 버리는 게 맞다는 결정이다. 안 눌러도 서버가 **24시간 뒤 자동으로**
   *    같은 것을 지우므로(`user_input_pruner`), 이 버튼은 쌓임을 막는 유일한
   *    수단이 아니라 **지금 비우는 경로**다. 그래서 ②가 실패해도 ③은 진행한다.
   *
   * 🔴 **다시보기(`reviewing`)의 「나가기」와 같은 동작이 아니게 됐다.**
   *    `ReviewBanner` 는 지난 run 을 **보고만** 있으므로 계속 `reset()` 만 부른다 —
   *    거기서 지우면 남의(혹은 예전) 실행 입력을 구경하다 삭제하는 꼴이다.
   *    두 자리의 주석이 「같은 동작」이라고 적혀 있었는데 이제 아니다.
   *
   * 🔴 지울 것을 **먼저 세어 보여준다.** 「초기화」라는 말만 띄우면 사용자는
   *    브라우저 상태만 지워지는 줄 안다(절대원칙 4). 프리셋 도메인이면 지울 게
   *    없으므로 그 문장도 넣지 않는다 — 없는 삭제를 예고하는 것도 거짓이다.
   *
   * 🔴 **확인은 `confirm()` 이 아니라 타이핑 모달이다**(2026-08-14, 백엔드 회신).
   *    이건 파일 하나가 아니라 **폴더 통째**이고 서버 쪽에 `force` 같은 우회가
   *    없다 — 되돌릴 방법이 아예 없다. 엔터 한 번에 넘어가는 확인창을 파일 단위
   *    삭제와 **같은 걸로 쓰면 안 된다**. 이름을 치게 하는 자리는 `ResetConfirmModal`.
   */
  const [resetting, setResetting] = useState(false);
  const [counting, setCounting] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);
  const [confirmTargets, setConfirmTargets] = useState<ResetTargets | null>(null);

  /**
   * 1단계 — **세고 묻는다.** 여기서는 아무것도 안 지운다.
   *
   * 🔴 셀 수 없으면 **파일에 손대지 않는다**(`deletable` 이 `null` 로 남는다).
   *    모르는 채로 지우는 것보다 안 지우는 게 낫다 — 안 지워도 서버가 나중에
   *    자동으로 정리한다(`user_input_pruner`).
   */
  const openResetConfirm = async () => {
    if (resetting || counting) return;
    const runId = run?.run_id ?? null;
    const domain = run?.domain ?? null;

    let deletable: { law: number; data: number } | null = null;
    let countReason: string | null = null;
    if (domain) {
      setCounting(true);
      try {
        const row = (await fetchDomains()).find((d) => d.domain === domain);
        if (!row) {
          countReason = "업로드 목록에 없습니다(이미 정리됐습니다).";
        } else if (row.root === "upload") {
          deletable = { law: row.law_files, data: row.data_files };
        } else if (row.root === "preset") {
          /**
           * 🔴 프리셋은 **라우트를 아예 안 친다.** 서버가 거절해 주니 그냥 쳐도
           *    된다고 읽기 쉬운데, 그 거절은 **404 가 아니라 400** 이다
           *    (`upload.py:_dirs():163→166` — 라우터의 뿌리가 `datasets/user_input/`
           *    뿐이라 프리셋은 **조건이 아니라 경로상** 닿지 않는다). 즉 「없는
           *    도메인」과 같은 답이 아니고, 400 을 받으면 화면에는 사용자가 뭘
           *    잘못한 것처럼 뜬다. 여기서 갈라야 그 문장이 안 나온다 —
           *    「어차피 서버가 막는다」며 이 분기를 접지 말 것.
           */
          countReason = "배포 원본(읽기 전용)이라 파일은 지워지지 않습니다.";
        } else {
          // `root` 가 없는 서버 = 루트 분리 **전** 배포 = 이 삭제 라우트도 없다
          // (같은 커밋에서 같이 생겼다). 쳐봐야 404·405 라 치지 않는다.
          countReason = "이 서버는 도메인 초기화를 지원하지 않습니다(옛 판).";
        }
      } catch (e) {
        countReason = `무엇이 지워지는지 확인하지 못했습니다 — ${describeFailure(e)}`;
      } finally {
        setCounting(false);
      }
    }

    setConfirmTargets({
      runId,
      live: live || run?.status === "awaiting_hitl",
      domain,
      deletable,
      countReason,
    });
  };

  /** 2단계 — 실제로 지운다. 모달에서 이름을 맞게 친 뒤에만 불린다. */
  const runReset = async (t: ResetTargets) => {
    setConfirmTargets(null);
    setResetting(true);
    setResetNote(null);
    const notes: string[] = [];

    // ① run 취소. 404(없는 run)·409(이미 끝남)는 **정상**이다 — 취소할 게 없다는 뜻이다.
    if (t.runId) {
      try {
        await cancelRun(t.runId);
      } catch (e) {
        const skip = e instanceof ApiError && (e.status === 404 || e.status === 409);
        if (!skip) notes.push(`실행 취소 실패 — ${describeFailure(e)}`);
      }
    }

    // ② 도메인 삭제. 셀 수 있었던 경우에만 친다.
    if (t.domain && t.deletable) {
      try {
        const r = await resetDomain(t.domain);
        notes.push(
          `「${t.domain}」 파일 ${r.files_removed}개(${(r.bytes_removed / 2 ** 20).toFixed(1)} MB)와 ` +
            `벡터 청크 ${r.vector_chunks_removed}개를 지웠습니다.`,
        );
      } catch (e) {
        // 🔴 재시도 버튼을 달지 않는다. 409 는 `force` 가 없는 종류라 다시 쳐도 같은
        //    답이고, 성공해서도 안 된다(다른 실행이 그 입력을 읽고 있다).
        //    문구는 서버 것을 그대로 쓴다 — 500 두 갈래(청크만 지워짐 / 아무것도
        //    안 지워짐)를 우리가 다시 쓰면 뜻이 뭉개진다.
        //
        // ⚠ 뒤에 붙이는 위안 문구는 **서버 규칙 그대로**여야 한다. 자동 정리 시계는
        //   지금이 아니라 `max(마지막 업로드, 마지막 run 종료)` 에서 시작하고,
        //   진행 중인 run(`queued`·`running`·`awaiting_hitl`)이 하나라도 있으면
        //   시각과 무관하게 **건너뛴다**(`app/services/user_input_pruner.py` 머리주석,
        //   `origin/back_deploy` 에서 실측).
        //
        // 🔴 그래서 **상태별로 다른 문장이다.** 처음엔 한 문장을 전부에 붙였는데
        //    409(진행 중인 run 이 있다) 에 맞춘 그 문장을 500 에 붙이면 **거짓**이다 —
        //    500 자리엔 기다릴 실행이 없다. 「곧 알아서 정리된다」는 위안은 조건이
        //    틀리면 그냥 안 지워진 채로 끝난다(절대원칙 4).
        const wait =
          e instanceof ApiError && e.status === 409
            ? "진행 중인 실행이 끝나고 24시간이 지나면 서버가 자동으로 정리합니다"
            : "마지막 업로드·마지막 실행 종료로부터 24시간이 지나면 서버가 자동으로 정리합니다";
        notes.push(`업로드 삭제 실패 — ${describeFailure(e)} (${wait})`);
      }
    }

    // ③ 브라우저 상태. ②가 실패해도 한다 — run 은 이미 취소됐고, 죽은 run 을
    //    가리킨 채로 두는 게 더 나쁘다.
    reset();
    setResetting(false);
    setResetNote(notes.length ? notes.join("\n") : null);
    router.push("/");
  };

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-hairline bg-glass-mid backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-5">
          {/*
            🔴 로고도 **화면 1 로 가는 문**이다. 내비만 잠그면 다시보기 중에 로고를
               눌러 데이터 입력 화면으로 들어갈 수 있다 — 잠근 문 옆에 열린 문을
               두는 셈이다. 다시보기 동안에는 링크를 걷는다(문구는 그대로 둔다).
          */}
          {reviewing ? (
            <span
              className="flex shrink-0 cursor-not-allowed items-baseline gap-2 text-ink-secondary/60"
              title="기록 다시보기 중입니다. 새로 시작하려면 아래 띠의 「나가기」를 누르세요."
            >
              <span className="text-[15px] font-semibold tracking-tight">OmniSite</span>
            </span>
          ) : (
            <Link href="/" className="flex shrink-0 items-baseline gap-2">
              <span className="text-[15px] font-semibold tracking-tight">OmniSite</span>
            </Link>
          )}

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {NAV_SCREENS.map((s, i) => {
              const active = current?.no === s.no;
              let done = isScreenReady(run, s.no, hearingDone) && !active;
              let allowed = isScreenAllowed(run, s.no, hearingDone);
              
              if (s.no === "3" && run?.status === "awaiting_hitl" && !unlockedWeight) {
                allowed = false;
              }

              // 데모 시연을 위한 순차 진행 강제 잠금
              if (i > highestIndex) {
                allowed = false;
                done = false;
              }

              // 지금 보고 있는 화면은 언제나 열려 있다(순차 잠금이 자기 자신을 잠그지 않게).
              if (active) {
                allowed = true;
              }

              /**
               * 🔴 **기록 다시보기 중에는 화면 1 로 못 간다.**
               *    화면 1 은 파일을 올려 **새 실행을 만드는** 화면이다. 지난 기록을
               *    보다가 여기로 들어가면 화면은 그 run 을 열어 둔 채 다른 run 을
               *    시작하게 되고, 그 뒤 화면 2~6 은 **어느 실행의 산출물인지가 섞인다**.
               *    나가는 문은 헤더의 「데이터 초기화」다(`reset()` 이 깃발을 지운다).
               * 🔴 위 순차 잠금으로는 못 막는다 — 다시보기는 `/report`(마지막 화면)에
               *    떨어지므로 `highest_nav_index_*` 가 곧바로 전 화면을 열어 준다.
               *    그래서 **잠금 뒤에** 따로 닫는다.
               * ⚠ 바로 위 `if (active)` 보다 **뒤에** 있어야 한다 — 앞에 두면 다시보기
               *   중에 화면 1 에 서 있을 때 잠금이 풀린다.
               */
              const blocked = reviewing && s.no === "1";
              if (blocked) {
                allowed = false;
              }

              const inner = (
                <>
                  <span
                    className={[
                      "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-semibold transition-colors",
                      active
                        ? "bg-white/25 text-white"
                        : done
                          ? "bg-primary/12 text-primary"
                          : allowed
                            ? "bg-black/[0.06] text-ink-secondary"
                            : "bg-black/[0.03] text-ink-secondary/30",
                    ].join(" ")}
                  >
                    {done ? "✓" : s.no}
                  </span>
                  <span className="whitespace-nowrap">{s.name}</span>
                </>
              );

              return (
                <div key={s.no} className="flex shrink-0 items-center">
                  {i > 0 && <span className="px-1 text-ink-secondary/40">›</span>}
                  {allowed ? (
                    <Link
                      /**
                       * 🔴 **들어가는 문은 `entryPath` 다**(있을 때만). 화면 5 는 경로가
                       *    셋이라 `path`(`/hearing`) 로 링크하면 방식을 고르는 화면을
                       *    건너뛰고 **A 로 바로** 떨어진다 — 그러면 B 는 URL 을 직접
                       *    쳐야 닿는 예전 상태로 돌아간다. 지금 어느 화면인지 판정하는
                       *    `screenOf` 는 여전히 `path` 를 쓴다(같이 바꾸면 A·B 화면에서
                       *    화면 5 표시가 꺼진다).
                       */
                      href={s.entryPath ?? s.path}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                        active
                          ? "bg-primary text-white"
                          : "text-ink-secondary hover:bg-black/[0.04] hover:text-ink",
                      ].join(" ")}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div
                      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-ink-secondary/40 cursor-not-allowed"
                      /*
                       * ⚠ 막힌 이유가 둘이므로 문구도 둘이다. 다시보기에서 화면 1 에
                       *   「이전 단계를 먼저 완료해주세요」가 뜨면 **거짓말**이다 —
                       *   화면 1 앞에는 이전 단계가 없고, 완료해도 안 열린다.
                       */
                      title={
                        blocked
                          ? "기록 다시보기 중입니다. 새로 시작하려면 아래 띠의 「나가기」를 누르세요."
                          : "이전 단계를 먼저 완료해주세요."
                      }
                    >
                      {inner}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-4 ml-4">
            {/* DEMO: 이 버튼은 서버의 run·업로드 파일을 지운다 — 지울 서버가 없다.
                처음부터 다시 보기는 `DemoBanner` 가 맡는다. */}
            {run && !DEMO && (
              <button
                onClick={openResetConfirm}
                disabled={resetting || counting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors border border-red-100 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                /* ⚠ 이 버튼은 이제 **서버 파일도 지운다**. 툴팁이 "진행 중인 데이터"
                     까지만 말하면 올린 파일이 같이 사라지는 걸 예고하지 못한다. */
                title="실행을 취소하고, 이 도메인에 올린 파일까지 지운 뒤 처음부터 다시 시작합니다"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                {/* 세는 중과 지우는 중은 **다른 상태**다. 둘 다 「초기화 중」이라고
                    쓰면 아직 아무것도 안 지운 시점이 이미 지운 것처럼 보인다. */}
                {resetting ? "초기화 중…" : counting ? "확인 중…" : "데이터 초기화"}
              </button>
            )}

            {/* 유틸리티 링크 (가이드라인 준수). DEMO 에서는 게시판·로그인이 녹화 밖이다. */}
            {!DEMO && (
            <div className="flex items-center gap-3 text-[12px] text-gray-600 font-medium">
              <Link href="/posts" className="hover:text-primary transition-colors font-semibold flex items-center gap-1 text-primary/90 bg-primary/8 px-2 py-1 rounded">
                <span>📋</span> 게시판
              </Link>
              <span className="text-gray-300">|</span>
              {user ? (
                <>
                  <Link href="/mypage" className="text-gray-800 hover:text-primary transition-colors font-semibold">
                    {maskName(user.username)}님
                  </Link>
                  <SessionBadge />
                  <span className="text-gray-300">|</span>
                  <Link href="/mypage" className="hover:text-primary transition-colors">마이페이지</Link>
                  <span className="text-gray-300">|</span>
                  <button onClick={handleLogout} className="hover:text-primary transition-colors">로그아웃</button>
                </>
              ) : (
                <>
                  <button onClick={() => { setAuthMode("login"); setAuthModalOpen(true); }} className="hover:text-primary transition-colors">로그인</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => { setAuthMode("register"); setAuthModalOpen(true); }} className="hover:text-primary transition-colors">회원가입</button>
                </>
              )}
            </div>
            )}

          </div>
        </div>
      </header>
      {/*
        초기화 결과. **성공도 실패도 남긴다** — 파일이 몇 개 지워졌는지는 사용자가
        확인할 수 있어야 하고(절대원칙 4), 실패는 더욱 그렇다. `router.push("/")`
        뒤에도 살아 있다 — 셸은 클라이언트 내비게이션에서 다시 마운트되지 않는다.
        🔴 `alert` 로 안 띄운다. 초기화 직후 화면 1 이 뜨는 흐름을 모달이 가로막고,
           내용이 여러 줄인데 alert 는 닫는 순간 사라져 되짚어볼 수가 없다.
      */}
      {resetNote && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-[12px] text-amber-900">
          <div className="mx-auto flex max-w-[1600px] items-start gap-3">
            <span className="whitespace-pre-wrap">{resetNote}</span>
            <button
              onClick={() => setResetNote(null)}
              className="ml-auto shrink-0 rounded px-2 py-0.5 text-amber-700 hover:bg-amber-100"
            >
              닫기
            </button>
          </div>
        </div>
      )}
      {confirmTargets && (
        <ResetConfirmModal
          targets={confirmTargets}
          onClose={() => setConfirmTargets(null)}
          onConfirm={() => runReset(confirmTargets)}
        />
      )}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
        onSuccess={(u) => setUser(u)}
      />
    </>
  );
}

function statusText(s: RunDoc["status"]): string {
  // 상태값을 한글로 바꾸되 의미를 보태지 않는다. failed 를 "오류"로 순화하지 않는다.
  //
  // 🔴 `awaiting_hitl` 을 "대기" 라고 쓰면 `queued` 와 같은 말이 된다. 둘 다 멈춰
  //    있지만 `queued` 는 서버가 곧 집어가고 이쪽은 **사람이 답할 때까지 영영**
  //    안 움직인다. 상단 배지는 좁아서 줄이고 싶어지는 자리인데, 여기서 줄이면
  //    사람이 실행이 알아서 굴러가는 줄 알고 기다린다.
  return {
    queued: "대기",
    running: "진행 중",
    awaiting_hitl: "확인 대기",
    succeeded: "완료",
    failed: "실패",
  }[s];
}

function maskName(name: string): string {
  if (!name) return "";
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + "*";

  const first = name.substring(0, 1);
  const last = name.substring(name.length - 1);
  const masked = "*".repeat(name.length - 2);

  return first + masked + last;
}
