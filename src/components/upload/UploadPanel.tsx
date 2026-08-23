"use client";

/**
 * 화면 1 업로드 패널 — 백엔드 2026-08-09 재작성판에 배선한다.
 * ===========================================================
 * 이 자리에 있던 것은 **장식이었다.** 점선 테두리 상자에 `onClick` 도
 * `<input type="file">` 도 없었고, 파일 하나도 서버로 가지 않았다. 화면은
 * "업로드할 수 있다" 고 말하고 있었으므로 원칙 4 위반이다.
 *
 * 배선 규칙
 *  · **도메인은 필수.** 7개 엔드포인트 전부가 요구한다. 다만 **묻지 않는다** —
 *    타이핑 중에 목록을 조회해 「있는 이름인가」를 그리던 자리는 지웠다
 *    (2026-08-14 사람 지시). 「다음 단계」를 누를 때 한 번만 묻고, 이름이 겹치면
 *    막는 대신 `<도메인>_2` 로 **다른 폴더**를 쓴다(`resolveDomain`).
 *    → 그래서 이 패널은 **자기가 쓴 폴더 이름을 부모에게 돌려준다**(`commit`).
 *      파이프라인이 그 이름으로 돌지 않으면 빈 폴더를 분석한다.
 *  · **서버가 준 값을 그대로 보여준다.** `renumbered`·`warnings`·
 *    `facility_type_source`·`redis_stale_removed`·`saved_to` 는 서버가
 *    일부러 내보낸 것이다. 프런트에서 접으면 그걸 내보낸 이유가 사라진다.
 *  · **실패 문구를 지어내지 않는다.** `ApiError.detail` 을 그대로 쓴다.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ApiError, NetworkError } from "@/lib/omnisite/client";
import {
  DATA_ACCEPT,
  LAW_ACCEPT,
  deleteDataFile,
  deleteRegulation,
  fetchDataFiles,
  fetchDomains,
  fetchRegulations,
  uploadDataFiles,
  uploadRegulations,
  type DataFile,
  type DataListResult,
  type RegulationItem,
  type RegulationUploadResult,
  type Renumbered,
} from "@/lib/omnisite/upload";

type Tab = "data" | "law";

/** 서버 응답 중 **사용자가 반드시 봐야 하는 부분**만 추린 알림. 내용은 서버 것 그대로다. */
interface Notice {
  kind: "ok" | "warn" | "error";
  title: string;
  lines: string[];
  renumbered?: Renumbered[];
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return `${e.status} — ${e.detail}`;
  if (e instanceof NetworkError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/**
 * 실패 응답 안에 들어 있는 **파일별 처리 내역**을 꺼낸다.
 *
 * 🔴 실패했다고 아무 일도 안 일어난 게 아니다. `POST /upload/regulation` 은 파일을
 *    **먼저 저장하고** 벡터 적재를 시도한다 — 조문이 하나도 없으면 422 인데 그때도
 *    `law/` 에는 파일과 추출 `.txt` 가 남아 있다(계약: 응답 `detail.files[]`).
 *    「업로드 실패」 한 줄만 띄우면 사람은 아무것도 안 남았다고 읽고 다시 올린다.
 *    사유(예: 「조문(제N조)을 하나도 못 찾았습니다」)도 이 배열 안에만 있다.
 *
 * 모양이 다르면 **지어내지 않고** 빈 배열을 준다 — 그때는 `detail` 한 줄만 보인다.
 */
function partialLines(e: unknown): string[] {
  if (!(e instanceof ApiError)) return [];
  const d = (e.body as { detail?: unknown } | null)?.detail;
  if (typeof d !== "object" || d === null) return [];
  const { saved_to, files } = d as { saved_to?: unknown; files?: unknown };
  const out: string[] = [];
  if (typeof saved_to === "string") out.push(`저장 위치: ${saved_to} (파일은 남아 있습니다)`);
  if (!Array.isArray(files)) return out;
  for (const raw of files) {
    const f = raw as {
      filename?: unknown;
      text_chars?: unknown;
      articles?: unknown;
      chunks?: unknown;
      warnings?: unknown;
    };
    if (typeof f.filename !== "string") continue;
    out.push(
      `${f.filename} · 텍스트 ${Number(f.text_chars ?? 0)}자 · ` +
        `조문 ${Number(f.articles ?? 0)}개 · 청크 ${Number(f.chunks ?? 0)}개`,
    );
    if (Array.isArray(f.warnings)) {
      for (const w of f.warnings) out.push(`  ⚠ ${String(w)}`);
    }
  }
  return out;
}

/**
 * 「업로드 중」 뒤에 붙는 점을 `.` → `..` → `...` 로 돌린다.
 *
 * 🔴 **장식이 아니다.** 업로드는 한 번의 `fetch` 라 진행률을 낼 자리가 없고
 *    (`XMLHttpRequest` 가 아니면 `upload.onprogress` 가 없다), 큰 파일에서는
 *    수십 초 동안 화면이 완전히 정지한 것처럼 보인다 — 사람은 그걸 「멈췄다」로
 *    읽고 새로고침한다. 점이 도는 것은 **아직 살아 있다**는 유일한 신호다.
 *
 * ⚠ 점 개수가 진행률을 뜻하지 않는다. 남은 시간을 아는 척하지 않는다(원칙 4).
 */
function useDots(active: boolean): string {
  const [n, setN] = useState(1);
  useEffect(() => {
    if (!active) return;
    // 🔴 여기서 `setN(1)` 로 초기화하지 않는다 — effect 안의 동기 setState 는
    //    `react-hooks/set-state-in-effect` 에 걸린다(이 파일 :96 과 같은 이유).
    //    시작 점 개수가 직전 값이어도 보이는 것은 똑같이 「돌고 있다」다.
    const t = setInterval(() => setN((v) => (v % 3) + 1), 400);
    return () => clearInterval(t);
  }, [active]);
  return ".".repeat(n);
}

/**
 * 이 세션이 **실제로 쓸 업로드 폴더 이름**을 정한다 — 이미 있으면 `_2`, `_3` …
 *
 * 🔴 **묻는 시점이 바뀐 것이 핵심이다**(2026-08-14 사람 지시). 예전엔 도메인 칸에
 *    글자가 들어올 때마다 목록을 물어 「있는 이름인가」를 화면에 그렸다 —
 *    `t|te|tes|test…` 한 글자마다 왕복이었고, 그 답으로 하는 일은 결국
 *    **경고 문구를 띄우는 것뿐**이었다. 이제 안 묻는다. 대신 「다음 단계」를
 *    누르는 **딱 한 번** 여기서 묻고, 겹치면 사람을 막는 대신 **다른 폴더를 준다.**
 *
 * 🔴 겹침 판정은 **두 루트를 다 본다.** 예전엔 `d.root !== "preset"` 로 프리셋을
 *    빼고 「별개 폴더라 비켜줄 이유가 없다」고 봤는데, 비켜주지 않으면 **셋이
 *    깨진다**(2026-08-16 실측, `재활용` 으로 재현):
 *      ⓐ 목록에서 **프리셋 행이 사라진다.** 서버는 이름 하나당 행 하나만 내고
 *         겹치면 업로드 쪽을 남긴다(`upload.py:573` `if n not in seen`).
 *         `root=preset` 로 따로 물으면 그대로 있다 — 지워진 게 아니라 가려진 것이다.
 *      ⓑ 그래서 화면1 프리셋 카드에서 **배포 원본이 통째로 안 보인다.**
 *         그 카드는 `root !== "upload"` 로 거른다(`page.tsx:PresetPicker`).
 *      ⓒ 🔴 제일 위험: `has_fixture` 가 **`true` 로 딸려온다.** 픽스처
 *         (`<도메인>_FIX`)는 프리셋 루트에 있고 행의 `root` 와 무관하다
 *         (`upload.py:555` 가 이 함정을 예고해 뒀다). 내가 올린 5개짜리
 *         `재활용` 을 hitl 로 돌리면 **배포 원본의 기준선**으로 돈다 — 400 도
 *         안 나고 그냥 돌아서, 안 터지고 값만 틀린다.
 *    `_2` 가 붙으면 이름이 달라지므로 셋 다 막힌다.
 *    ⚠ `root` 가 **없는**(루트 분리 전) 서버도 이제 같은 규칙이다 — 전부
 *      「쓰이고 있다」로 친다. 특례가 없어졌다.
 *
 * 🔴 목록을 못 받으면 **던진다.** 여기서 `base` 로 폴백하면 남이 쓰는 폴더에
 *    조용히 올리게 되는데, 그건 `datasets/흡연/data` 가 통째로 지워진
 *    2026-08-13 사고와 같은 자리다. 못 정하면 안 올린다.
 */
async function resolveDomain(base: string): Promise<string> {
  const taken = new Set((await fetchDomains()).map((d) => d.domain));
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 999; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`${base} 부터 ${base}_999 까지 전부 쓰이고 있습니다. 다른 이름을 쓰세요.`);
}

function kb(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 화면1 「다음 단계」가 잡는 손잡이. */
export interface UploadPanelHandle {
  /**
   * 고른 파일을 올리고 **이 세션이 실제로 쓴 도메인**을 돌려준다.
   * `null` 이면 넘어가지 말 것(사유는 패널이 화면에 적는다).
   *
   * 🔴 **문자열을 돌려주는 이유.** 같은 이름이 이미 있으면 `그늘막_2` 에 저장된다.
   *    부모가 그걸 모르고 `start("그늘막")` 을 치면 파일은 `그늘막_2` 에 있는데
   *    파이프라인은 `그늘막` 을 읽는다 — **안 터지고 빈 폴더로 분석한다.**
   */
  commit: () => Promise<string | null>;
}

export function UploadPanel({
  domain,
  ref,
}: {
  /** 화면 1 의 "분석 도메인" 입력값. 비어 있으면 아무 호출도 하지 않는다. */
  domain: string;
  /** React 19 는 `ref` 를 그냥 prop 으로 받는다(`forwardRef` 불필요). */
  ref?: Ref<UploadPanelHandle>;
}) {
  const [tab, setTab] = useState<Tab>("data");

  /**
   * 이번 세션이 **실제로 쓴** 폴더. `base` 는 사람이 친 이름, `actual` 은 `_2` 가
   * 붙었을 수도 있는 진짜 이름이다.
   *
   * 🔴 **한 번만 정한다.** 매번 `resolveDomain` 을 부르면 두 번째 업로드가
   *    `그늘막_2` 를 「이미 있다」로 보고 `그늘막_3` 을 새로 만든다 — 같은 세션의
   *    데이터가 폴더 두 개로 쪼개진다.
   * 🔴 사람이 이름을 **고쳐 쓰면** 무효다. 아래처럼 렌더 중에 대조해서 판단한다
   *    (effect 로 지우면 한 프레임 동안 옛 폴더 이름이 남는다).
   */
  const [saved, setSaved] = useState<{ base: string; actual: string } | null>(null);

  const [busy, setBusy] = useState(false);
  const dots = useDots(busy);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);

  const trimmed = domain.trim();
  /** 이미 올린 폴더. 사람이 이름을 고쳐 쓰면 `null` 로 돌아간다. */
  const savedDomain = saved && saved.base === trimmed ? saved.actual : null;

  // ── 올린 폴더의 파일 목록 ────────────────────────────────────
  /**
   * 🔴 「불러오는 중」을 **상태로 두지 않는다.** `setListLoading(true)` 는 effect 에서
   *    동기로 불릴 수밖에 없어 같은 규칙에 걸리고, 규칙 문제만도 아니다 — setState 는
   *    렌더가 끝난 뒤 도착하므로 탭·도메인이 바뀐 직후 한 프레임 동안 **직전 목록이
   *    남는다**(`useArtifact.ts` :79 · `useSelectedSite.ts` 가 같은 이유로 먼저 이
   *    모양이 됐다).
   *
   *    `listKey` 는 「무엇을 물었나」다. 저장된 답의 key 가 지금 key 와 다르면 그건
   *    **남의 답**이므로 안 내보내고 「불러오는 중」으로 친다. `listNonce` 는 사람이
   *    「새로고침」을 누른 횟수다 — 같은 것을 다시 묻는 유일한 길이다.
   */
  const [listNonce, setListNonce] = useState(0);
  /**
   * 🔴 **`trimmed` 가 아니라 `savedDomain` 이다**(2026-08-14 사람 지시).
   *    타이핑 중인 값을 key 에 담으면 글자마다 `loadList` 의 정체성이 바뀌어
   *    effect 가 다시 돈다 — 배포 서버 로그 실측으로 `?domain=t|te|tes|test|…`
   *    8건이 전부 400 이었고, 조례 탭은 목록 한 번이 **약 130초**라 특히 나빴다.
   *    `savedDomain` 은 **업로드가 끝나야** 생기므로 그때까지 이 값은 `null` 이고
   *    호출은 0건이다. 디바운스로 줄이던 자리가 통째로 없어졌다.
   *
   * ⚠ 그래서 업로드 전에는 목록이 **아예 안 뜬다**(대기도 아니다 — 안 물었다).
   *   어차피 겹치면 `_2` 로 새 폴더를 만드니 올리기 전 목록은 **항상 0개**였다.
   */
  const listKey = savedDomain ? `${savedDomain}::${tab}::${listNonce}` : null;

  const [listAnswer, setListAnswer] = useState<{
    key: string | null;
    dataList: DataListResult | null;
    lawList: RegulationItem[] | null;
    error: string | null;
  }>({ key: null, dataList: null, lawList: null, error: null });

  /**
   * 🔴 **`async/await` 가 아니라 `.then()/.catch()` 다.**
   *    `react-hooks/set-state-in-effect` 는 **await 뒤도 동기로 친다** — effect 에서
   *    부르는 async 함수 안이면 첫 await 뒤에 있어도 걸린다(실측). 규칙이 받아주는
   *    모양은 **콜백 안의 setState** 뿐이다.
   */
  const loadList = useCallback((): Promise<void> => {
    if (!listKey || !savedDomain) return Promise.resolve();
    const asked =
      tab === "data"
        ? fetchDataFiles(savedDomain).then((r) =>
            setListAnswer({ key: listKey, dataList: r, lawList: null, error: null }),
          )
        : fetchRegulations(savedDomain).then((r) =>
            setListAnswer({ key: listKey, dataList: null, lawList: r, error: null }),
          );
    return asked.catch((e: unknown) => {
      /*
       * 🔴 **400 은 오류가 아니라 「그 탭 폴더가 아직 없다」다.** 데이터만 올린
       *    사람이 조례 탭을 누르면 반드시 여기를 지난다. 서버 문구(`400 — 도메인
       *    폴더가 없습니다: /code/datasets/user_input/흡연 · …`)를 그대로 띄우면
       *    **정상 경로가 빨간 에러로 보인다**(2026-08-14 사람 지시로 제거).
       *
       * 🔴 400 **만** 접는다. 500·타임아웃·네트워크는 그대로 문구를 낸다 —
       *    전부 접으면 목록을 못 받은 것이 「파일 0개」로 보이고, 사람은 방금 올린
       *    파일이 사라진 줄 안다(조용한 실패 금지).
       */
      if (e instanceof ApiError && e.status === 400) {
        setListAnswer({ key: listKey, dataList: null, lawList: null, error: null });
        return;
      }
      setListAnswer({ key: listKey, dataList: null, lawList: null, error: describe(e) });
    });
  }, [listKey, savedDomain, tab]);

  /**
   * 🔴 디바운스가 없다. `listKey` 는 **업로드·삭제·탭 전환·새로고침**으로만 바뀌는데
   *    전부 사람이 한 번씩 하는 동작이라 늦출 것이 없다. 타이핑은 이제 이 key 를
   *    건드리지 않는다(위 `listKey` 주석).
   */
  useEffect(() => {
    if (!listKey) return;
    void loadList();
  }, [listKey, loadList]);

  // 렌더 중에 계산한다. `listKey` 가 없으면(도메인 비었음) 아무것도 안 물었으므로 대기도 아니다.
  const listFresh = listAnswer.key === listKey;
  const dataList = listFresh ? listAnswer.dataList : null;
  const lawList = listFresh ? listAnswer.lawList : null;
  const listError = listFresh ? listAnswer.error : null;
  const listLoading = listKey !== null && !listFresh;

  function resetPicked() {
    setPicked([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── 업로드 ──────────────────────────────────────────────────
  /**
   * @param stay 끝난 뒤 이 패널에 **머무는가**. 참이면 목록을 다시 읽는다.
   *
   *   🔴 「다음 단계」(`commit`)는 **거짓**이다. 그 순간 부모가 Step 2 로 넘어가며
   *      이 패널을 언마운트하므로 목록을 읽어봐야 아무도 안 본다 — 그런데 조례
   *      목록은 한 번이 **약 130초**라, 읽고 기다리면 「다음 단계」가 그만큼 멈춘다.
   *
   * @returns 다음 칸으로 넘어가도 되면 **실제로 쓴 도메인**, 막아야 하면 `null`.
   *          **「성공했다」가 아니라 「막을 이유가 없다」**다 — 올릴 게 없으면
   *          (`picked` 비었음) 이미 정해둔 폴더나 사람이 친 이름을 그대로 돌려준다.
   */
  async function onUpload(stay: boolean): Promise<string | null> {
    if (!trimmed) return null;
    if (picked.length === 0) return savedDomain ?? trimmed;
    setBusy(true);
    setNotice(null);
    let target = savedDomain;
    try {
      /*
       * 🔴 **여기가 도메인 목록을 묻는 유일한 자리다.** 이름이 겹치면 사람을
       *    막는 대신 `_2` 를 붙여 **다른 폴더**를 쓴다 — 남의 폴더에 올려서
       *    `datasets/흡연/data` 가 통째로 지워진 자리(2026-08-13)를 이렇게 막는다.
       *    한 세션에서는 한 번만 정한다(`saved` 주석).
       *
       * 🔴 **업로드 결과와 무관하게 여기서 바로 기억한다.** 실패해도 파일은 남을
       *    수 있고(`partialLines` 주석: 422 여도 `law/` 에 파일과 `.txt` 가 남는다),
       *    그때 폴더 이름을 안 들고 있으면 **뭐가 남았는지 물어볼 데가 없다.**
       */
      if (target === null) {
        target = await resolveDomain(trimmed);
        setSaved({ base: trimmed, actual: target });
      }
      if (tab === "data") {
        const r = await uploadDataFiles({
          domain: target,
          files: picked,
          // 🔴 **항상 true 다**(2026-08-14 사람 지시 「업로드 하면 새로 폴더를 만들어야
          //    하니까」). 서버는 이미 있는 폴더면 아무것도 안 한다
          //    (`upload.py:154` `if create and not root.is_dir():`) — 멱등이다.
          //    ⚠ 잃은 것: 도메인 이름 오타가 이제 **조용히 새 폴더를 만든다.**
          //      막는 자리는 여기가 아니라 화면1 의 도메인 칸이다.
          createDomain: true,
        });
        const lines = [
          `저장 위치: ${r.saved_to}`,
          `dataset 총 ${r.dataset_count}개`,
          ...r.files.map(
            (f) =>
              `${f.filename} · ${kb(f.size)}` +
              (f.replaced ? " · 덮어씀" : "") +
              (f.is_dataset ? "" : " · 부속 파일(dataset 아님)"),
          ),
        ];
        if (r.warning) lines.push(r.warning);
        setNotice({
          kind: r.renumbered.length > 0 ? "warn" : "ok",
          title: `데이터 ${r.files.length}개 업로드 완료`,
          lines,
          renumbered: r.renumbered,
        });
      } else {
        const r: RegulationUploadResult = await uploadRegulations({
          domain: target,
          files: picked,
          createDomain: true, // 위 데이터 업로드와 같은 이유(멱등).
        });
        const lines = [`저장 위치: ${r.saved_to}`];
        // 🔴 못 정한 경우(`facility_type: null` · 출처 `unknown`)는 **정상**이라
        //    아무 말도 하지 않는다. 예전 문구를 그대로 두면 「시설 종류 태깅: null
        //    (출처 unknown)」 이 찍혀서 정상 업로드가 고장으로 읽힌다. 격리는 이제
        //    도메인별 콜렉션이 맡으므로 이 값이 없어도 잃는 게 없다.
        if (r.facility_type) {
          lines.push(`시설 종류 태깅: ${r.facility_type} (출처 ${r.facility_type_source})`);
        }
        lines.push(`조례 파일 총 ${r.law_files_total}개`);
        for (const f of r.files) {
          lines.push(
            `${f.filename} · ${kb(f.size)} · 조문 ${f.articles}개(규제 ${f.regulatory_articles}) · ` +
              `청크 ${f.chunks}개` +
              (f.deleted_old_chunks > 0 ? ` (옛 청크 ${f.deleted_old_chunks}개 삭제)` : "") +
              (f.ingested ? "" : " · 🔴 벡터 DB 미적재") +
              (f.has_siting_provision ? ` · 입지규정 감지: ${f.siting_signals.join(", ")}` : ""),
          );
          for (const w of f.warnings) lines.push(`  ⚠ ${f.filename}: ${w}`);
        }
        const anyWarn = r.files.some((f) => f.warnings.length > 0 || !f.ingested);
        setNotice({
          kind: anyWarn ? "warn" : "ok",
          title: `조례 ${r.files.length}개 업로드 완료`,
          lines,
        });
      }
      resetPicked();
      if (stay) setListNonce((n) => n + 1);
      return target;
    } catch (e) {
      const extra = partialLines(e);
      setNotice({
        kind: "error",
        title: extra.length > 0 ? "업로드 실패 — 일부는 적용됐습니다" : "업로드 실패",
        lines: [describe(e), ...extra],
      });
      // 🔴 실패해도 목록을 다시 읽는다. 저장은 됐는데 화면만 「0개」로 남으면
      //    사람은 같은 파일을 또 올린다. 단 **폴더가 정해진 뒤**에만 —
      //    `resolveDomain` 자체가 실패했으면 물어볼 폴더가 없다.
      if (stay && target !== null) setListNonce((n) => n + 1);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /**
   * 화면1 「다음 단계」가 부른다 — **고른 파일을 여기서 서버로 보낸다**(2026-08-14
   * 사람 지시 「그냥 업로드단 다음 단계 버튼 누르면 api 보내는걸로 하면 어때?」).
   *
   * 🔴 이 자리인 이유: `page.tsx:162` 이 `{activeStep === 1 && …}` 라 다음 칸으로
   *    넘어가는 순간 이 패널이 **언마운트되고 `picked` 가 사라진다.** 「분석 시작하기」
   *    에 묶으려면 파일 목록을 부모로 끌어올려야 하는데, 다음 단계 시점엔 패널이
   *    아직 살아 있으므로 그럴 필요가 없다.
   *
   * 🔴 실패하면 `null` 이다 — 부모는 넘어가지 않는다. 사유는 이 패널의 `notice` 가
   *    이미 말하고 있으므로 부모가 문구를 지어내지 않는다.
   *
   * 🔴 `stay: false` — 넘어가는 길이라 목록을 다시 읽지 않는다(`onUpload` 주석).
   */
  useImperativeHandle(ref, () => ({ commit: () => onUpload(false) }));

  // ── 삭제 ────────────────────────────────────────────────────
  async function onDelete(filename: string) {
    // 목록은 `savedDomain` 것만 뜨므로 지우는 대상도 그 폴더다 — 사람이 친 이름
    // (`trimmed`)으로 지우면 `_2` 가 붙은 세션에서 **남의 폴더 파일을 지운다.**
    if (!savedDomain) return;
    setBusy(true);
    setNotice(null);
    try {
      if (tab === "data") {
        const r = await deleteDataFile(savedDomain, filename);
        const lines = [`dataset 총 ${r.dataset_count}개`];
        if (r.warning) lines.push(r.warning);
        setNotice({
          kind: r.renumbered.length > 0 ? "warn" : "ok",
          title: `삭제: ${r.filename}`,
          lines,
          renumbered: r.renumbered,
        });
      } else {
        const r = await deleteRegulation(savedDomain, filename);
        setNotice({
          kind: "ok",
          title: `삭제: ${r.filename}`,
          lines: [
            `추출 캐시 ${r.extract_cache_removed ? "삭제됨" : "없음"}`,
            `벡터 청크 ${r.vector_chunks_removed}개 삭제`,
          ],
        });
      }
      setListNonce((n) => n + 1);
    } catch (e) {
      setNotice({ kind: "error", title: "삭제 실패", lines: [describe(e)] });
    } finally {
      setBusy(false);
    }
  }

  const accept = tab === "data" ? DATA_ACCEPT : LAW_ACCEPT;

  return (
    <div className="p-8">
      {/* ── 탭 ── */}
      <div className="flex gap-2 p-1 rounded-xl bg-gray-100/80 max-w-sm mb-6">
        {(
          [
            ["data", "📊 분석 데이터"],
            ["law", "📄 조례·법규"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k);
              resetPicked();
              setNotice(null);
            }}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
              tab === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        🔴 여기 있던 **도메인 상태 상자를 지웠다**(2026-08-14 사람 지시).
           그 상자는 「이 이름이 백엔드에 있나」를 묻고 그 답으로 경고를 그렸는데,
           묻는 값이 타이핑 중인 도메인이라 **글자마다 왕복**했다. 겹침은 이제
           경고가 아니라 `_2` 폴더로 처리하므로(`resolveDomain`) 물을 일이 없다.
           남은 것은 **아무것도 안 묻는** 이 한 줄뿐이다.
      */}
      {!trimmed && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-sm">
          <p className="text-gray-600">
            위 <strong>분석 주제</strong>를 먼저 입력하세요. 업로드 API 는 전부 도메인이
            필수입니다 — 도메인이 없으면 어느 파이프라인의 입력인지 정할 수 없습니다.
          </p>
        </div>
      )}

      {/* ── 파일 선택 ── */}
      <label
        className={`block w-full rounded-xl border-2 border-dashed py-12 px-6 text-center transition-colors ${
          trimmed
            ? "border-gray-300 bg-gray-50/50 hover:bg-gray-50 hover:border-blue-400 cursor-pointer"
            : "border-gray-200 bg-gray-50 cursor-not-allowed opacity-60"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={accept}
          disabled={!trimmed || busy}
          className="sr-only"
          onChange={(e) => setPicked(Array.from(e.target.files ?? []))}
        />
        <div className="w-14 h-14 mx-auto bg-white rounded-full shadow-sm border border-gray-100 flex items-center justify-center mb-3">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </div>
        <h3 className="text-base font-bold text-gray-800">클릭하여 파일 선택 (여러 개 가능)</h3>
        <p className="text-sm text-gray-500 mt-2 max-w-lg mx-auto leading-relaxed">
          {tab === "data" ? (
            <>
              업로드 가능 형식: <code className="font-mono text-xs">{DATA_ACCEPT}</code>
              <br />
              <span className="text-gray-400">
                공간 정보 파일(.shp)을 올리실 때는 반드시 관련된 부속 파일들(.dbf, .shx, .prj)도 같이 선택해서 올려주세요.
              </span>
            </>
          ) : (
            <>
              업로드 가능 형식: <code className="font-mono text-xs">{LAW_ACCEPT}</code>
              <br />
              <span className="text-gray-400">
                일반 한글 문서(.hwp)나 워드(.doc)는 시스템에서 분석하기 어렵습니다. 번거로우시더라도 최신 한글 문서(.hwpx)나 PDF 형식으로 변환하여 올려주세요.
              </span>
            </>
          )}
        </p>
      </label>

      {/* ── 선택된 파일 + 업로드 버튼 ── */}
      {picked.length > 0 && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
          <ul className="text-sm text-gray-700 space-y-1">
            {picked.map((f) => (
              <li key={f.name} className="flex justify-between gap-4">
                <span className="truncate font-mono text-xs">{f.name}</span>
                <span className="shrink-0 text-gray-500">{kb(f.size)}</span>
              </li>
            ))}
          </ul>
          {/* 합계를 미리 보여준다 — 왜 오래 걸리는지는 누른 뒤가 아니라 누르기 전에 알아야 한다. */}
          {picked.length > 1 && (
            <p className="mt-2 border-t border-blue-200 pt-2 text-right text-xs text-gray-500">
              합계 {kb(picked.reduce((s, f) => s + f.size, 0))}
            </p>
          )}
          {/* 🔴 조례 탭에도 **추가로 물을 것이 없다.** 예전엔 「시설 유형」(필수)과
              「벡터 DB 적재」 체크박스가 여기 있었다. 전자는 조례가 한 콜렉션에
              섞여 있던 시절의 격리 키였고 백엔드가 도메인별 콜렉션으로 가르면서
              부가정보로 내려갔다. 후자는 끄면 토론이 근거를 못 찾을 뿐이라 고를
              이유가 없었다 — 둘 다 안 보내면 서버가 알아서 한다(`upload.ts`). */}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              // 🔴 `stay: true` — 이 버튼은 패널에 머문다. 「다음 단계」와 다른 점이
              //    여기뿐이다(`onUpload` 주석).
              onClick={() => void onUpload(true)}
              disabled={busy}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-60"
            >
              {busy ? (
                <>
                  <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  업로드 중
                  {/* 점이 늘었다 줄었다 해도 버튼 폭은 그대로여야 한다 — 폭이 흔들리면
                      옆 버튼이 같이 움직여서 「뭔가 잘못됐다」로 읽힌다. */}
                  <span className="inline-block w-4 text-left tabular-nums">{dots}</span>
                </>
              ) : (
                `${picked.length}개 업로드`
              )}
            </button>
            <button
              type="button"
              onClick={resetPicked}
              disabled={busy}
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              선택 해제
            </button>
          </div>
        </div>
      )}

      {/* ── 서버 응답 ── */}
      {notice && (
        <div
          className={`mt-4 rounded-xl border p-4 text-sm ${
            notice.kind === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : notice.kind === "warn"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-green-200 bg-green-50 text-green-900"
          }`}
        >
          <p className="font-bold">{notice.title}</p>
          <ul className="mt-2 space-y-0.5 font-mono text-xs break-all">
            {notice.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {/**
            * 🔴 **빨간 상자는 `renumbered` 전용이다**(백엔드 2026-08-16 요청 4).
            *    「01~03 번호가 이렇게 잡혔다」를 여기 같이 그리지 않는다 — 그건
            *    경고가 아니라 정보이고, 이미 **바로 아래 목록의 `dataset_id` 칸**이
            *    전량 그리고 있다(`GET /data` 의 `dataset_id` 는 서버에서
            *    `dataset_map` 과 같은 `_dataset_map()` 으로 낸다: `upload.py:1201,1221`).
            *    응답의 `dataset_map` 을 여기 한 번 더 펴면 같은 사실이 화면에
            *    두 벌이 되고, 둘이 어긋나 보이는 순간 어느 쪽이 정본인지 알 수 없다.
            */}
          {notice.renumbered && notice.renumbered.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-400 bg-white/70 p-3">
              <p className="font-bold text-amber-900">
                🔴 dataset_id 가 밀렸습니다 ({notice.renumbered.length}건)
              </p>
              <p className="mt-1 text-[13px] text-amber-800">
                dataset_id 는 파일명 가나다순입니다. 이미 감리·정제를 돌렸다면 그 결과가
                <strong> 엉뚱한 파일에 붙습니다</strong> — 재프로파일 → 재감리가 필요합니다.
              </p>
              <ul className="mt-2 font-mono text-xs text-amber-900 space-y-0.5">
                {notice.renumbered.map((r) => (
                  <li key={r.dataset_id}>
                    {r.dataset_id}: {r.before} → {r.after}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── 현재 목록 ── */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-gray-800">
            {tab === "data" ? "업로드된 데이터" : "업로드된 조례"}

          </h4>
          <button
            type="button"
            // 🔴 `loadList()` 를 직접 부르지 않는다 — key 가 그대로라 「불러오는 중」이
            //    안 뜬다. 조례 목록은 매번 약 130초라 그 표시가 없으면 눌러도
            //    아무 일도 안 일어난 것처럼 보인다.
            onClick={() => setListNonce((n) => n + 1)}
            // 아직 올린 적이 없으면 물어볼 폴더가 없다.
            disabled={!savedDomain || busy}
            className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
          >
            새로고침
          </button>
        </div>

        {!savedDomain ? (
          /*
           * 🔴 **「아직 안 물었다」와 「0개다」는 다른 문장이다.** 업로드 전에는
           *    폴더가 아예 없으므로(겹치면 `_2` 로 새로 만든다) 조회할 것이 없다.
           *    여기에 「아직 없습니다」를 띄우면 **서버에 물어본 결과 0개**로 읽힌다.
           */
          <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center text-sm text-gray-400">
            올리면 여기에 목록이 뜹니다.
          </p>
        ) : listLoading ? (
          <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            불러오는 중...
            {tab === "law" && (
              <span className="mt-1 block text-xs text-gray-400">
                🔴 멈춘 게 아니라 <strong>매번 약 130초</strong> 걸립니다(2026-08-10
                실측, 2회 연속 130.04s). 조례 목록은 벡터 DB 청크 수를 같이 세는데
                백엔드 DSN 호스트가 <code className="font-mono">localhost</code> 라
                IPv6(<code className="font-mono">::1</code>)를 먼저 시도하고 그 타임아웃을
                다 기다린 뒤 IPv4 로 붙습니다. 백엔드 쪽 설정 문제로 전달했습니다.
              </span>
            )}
          </p>
        ) : listError ? (
          /*
           * 🔴 여기 오는 건 **400 이 아닌 것**뿐이다(400 = 그 탭 폴더가 아직 없음 →
           *    위 `loadList` 에서 빈 목록으로 접었다). 즉 진짜 고장이므로 서버 문구를
           *    그대로 낸다 — 지어내지 않는다.
           */
          <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-600 break-all">
            {listError}
          </p>
        ) : tab === "data" ? (
          <DataTable list={dataList} busy={busy} onDelete={onDelete} />
        ) : (
          <LawTable items={lawList} busy={busy} onDelete={onDelete} />
        )}
      </div>
    </div>
  );
}

/**
 * 삭제 버튼 한 칸.
 *
 * 🔴 **판정을 프런트가 다시 하지 않는다.** 서버가 준 `deletable` 만 본다 —
 *    「업로드 원장에 있나」는 디스크(`datasets/<도메인>/.upload_ledger.json`)가
 *    정본이고, 그 규칙을 화면이 흉내 내면 서버와 갈라진다. 값이 없는 옛 응답
 *    (`undefined`)은 예전처럼 지울 수 있게 둔다 — 서버가 `force` 없이 409 로
 *    막으므로 화면이 앞서 막을 필요가 없다.
 *
 * 🔴 **숨기지 않고 비활성화한다.** 버튼이 사라지면 「왜 못 지우나」가 화면에서
 *    사라진다 — 이 파일이 실제로 지워져서 프리셋 모드가 죽었던 사고다(2026-08-13).
 */
function DeleteCell({
  filename,
  deletable,
  busy,
  onDelete,
}: {
  filename: string;
  deletable: boolean | undefined;
  busy: boolean;
  onDelete: (f: string) => void;
}) {
  const blocked = deletable === false;
  return (
    <button
      type="button"
      onClick={() => onDelete(filename)}
      disabled={busy || blocked}
      title={
        blocked
          ? "이 폴더에 원래 있던 배포 원본입니다. 프리셋 모드가 읽으므로 여기서 지울 수 없습니다."
          : undefined
      }
      className={
        blocked
          ? "shrink-0 rounded px-2 py-1 text-xs text-gray-300 cursor-not-allowed"
          : "shrink-0 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
      }
    >
      삭제
    </button>
  );
}

function DataTable({
  list,
  busy,
  onDelete,
}: {
  list: DataListResult | null;
  busy: boolean;
  onDelete: (f: string) => void;
}) {
  if (!list) return <Empty />;
  if (list.files.length === 0) return <Empty />;
  return (
    <>
      {list.redis_stale_removed.length > 0 && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Redis 색인에만 남아 있던 {list.redis_stale_removed.length}건을 정리했습니다:{" "}
          <span className="font-mono">{list.redis_stale_removed.join(", ")}</span>
        </p>
      )}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {list.files.map((f: DataFile) => (
          <li key={f.filename} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="w-8 shrink-0 font-mono text-xs text-blue-700">
              {f.dataset_id ?? "—"}
            </span>
            <span className="flex-1 truncate font-mono text-xs text-gray-800">{f.filename}</span>
            <span className="shrink-0 text-xs text-gray-500">{kb(f.size)}</span>
            <span
              className={`w-28 shrink-0 text-right text-xs ${
                f.deletable === false ? "text-amber-700" : "text-gray-400"
              }`}
            >
              {f.deletable === false ? "배포 원본(프리셋용)" : "업로드"}
            </span>
            <DeleteCell filename={f.filename} deletable={f.deletable} busy={busy} onDelete={onDelete} />
          </li>
        ))}
      </ul>

    </>
  );
}

function LawTable({
  items,
  busy,
  onDelete,
}: {
  items: RegulationItem[] | null;
  busy: boolean;
  onDelete: (f: string) => void;
}) {
  if (!items || items.length === 0) return <Empty />;
  return (
    <>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {items.map((f) => (
          <li key={f.filename} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1 truncate font-mono text-xs text-gray-800">{f.filename}</span>
            <span className="shrink-0 text-xs text-gray-500">{kb(f.size)}</span>
            <span
              className={`w-24 shrink-0 text-right text-xs ${
                f.text_ready ? "text-gray-400" : "text-amber-700 font-semibold"
              }`}
            >
              {f.text_ready ? "텍스트 준비됨" : "텍스트 없음"}
            </span>
            <span className="w-20 shrink-0 text-right text-xs text-gray-500">
              청크 {f.chunks_in_vector_db}
            </span>
            <span
              className={`w-28 shrink-0 text-right text-xs ${
                f.deletable === false ? "text-amber-700" : "text-gray-400"
              }`}
            >
              {f.deletable === false ? "배포 원본(프리셋용)" : "업로드"}
            </span>
            <DeleteCell filename={f.filename} deletable={f.deletable} busy={busy} onDelete={onDelete} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-400">
        &ldquo;텍스트 없음&rdquo;은 파일은 저장됐지만 STEP1 감리가 못 읽는다는 뜻입니다(스캔본 PDF 등).
        청크 0 이면 토론 단계 조례 검색에도 안 잡힙니다.
      </p>
    </>
  );
}

function Empty() {
  return (
    <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center text-sm text-gray-400">
      아직 없습니다.
    </p>
  );
}
