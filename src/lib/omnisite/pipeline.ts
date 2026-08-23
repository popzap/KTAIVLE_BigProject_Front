/**
 * 파이프라인 실행 API — `pipeline_run_contract.md` 가 유일한 기준.
 * =============================================================
 * 라우트는 **7개다.** 실측 2026-08-14, **배포 브랜치**(`origin/back_deploy`)의
 * `app/api/v1/pipeline.py` 를 직접 읽은 값이다:
 *
 *   POST   /api/v1/pipeline/runs                        :67  → 202 {run_id}
 *   GET    /api/v1/pipeline/runs?mine=true              :96  → 아래 참고
 *   GET    /api/v1/pipeline/runs/{run_id}               :165 → status.json 원문
 *   DELETE /api/v1/pipeline/runs/{run_id}               :178 → 204 (실행 취소)
 *   POST   /api/v1/pipeline/runs/{id}/hitl/{gate_id}    :203 → 게이트 답변
 *   GET    /api/v1/pipeline/runs/{run_id}/log[?tail=N]  :224 → 실행 로그
 *   GET    /api/v1/pipeline/runs/{run_id}/artifacts/{n} :242 → 산출물 파일 원본
 *
 * 🔴 **브랜치를 적어두는 이유.** 이 표면은 브랜치마다 다르다 — `main` 에는
 *    `GET /runs` 도 `DELETE /runs/{id}` 도 **없다.** 「백엔드에 있다」가 아니라
 *    「우리가 치는 서버에 있다」여야 근거가 된다.
 *
 * 쓰기 API 는 **이제 있고 이제 쓴다** — 화면 2 · 3 이 게이트 답변 화면이 됐다
 * (2026-08-05, 계약 7절):
 *
 *   POST /api/v1/pipeline/runs/{id}/hitl/audit    게이트A
 *   POST /api/v1/pipeline/runs/{id}/hitl/weight   게이트B
 *   → 200 이면 본문은 **답변 직후의 status.json**(이미 `running`, `gate` 키 없음)
 *
 * 알아야 할 것:
 *
 *    - 본문에 **`run_id` 를 넣어야 한다.** 경로와 다르면 400 이다 — 프런트가 다른
 *      run 을 보고 있다는 뜻이라 조용히 경로 쪽을 쓰지 않는다.
 *    - 둘 다 **게이트 단위 배치**다. 항목 1건씩 보내면 `apply_weight_hitl` 이
 *      전 슬라이더 `sum(abs(v)) > 0` 을 검증할 수 없다 — 검증을 빼면 전 후보
 *      점수가 0 이 된다(백엔드가 실제로 겪은 사고).
 *    - 게이트A: `{run_id, exclusions[], intents[], code_prefixes[]}`. 세 배열 다
 *      선택이고 고칠 게 없으면 `{run_id}` 만. 🔴 `radius_m: null`(= 반경 없는 면
 *      배제)과 **키 생략**(= 건드리지 않음)은 **다른 뜻**이다. `editable: false`
 *      항목을 보내면 400 — 보여주되 못 고친다.
 *    - 게이트B: `{run_id, radius{}, slider{}}` **이 셋뿐**이다. 다른 키는 400.
 *      🔴 `slider` 는 `-1 ~ +1` 을 **그대로** 보낸다. 프런트가 `{seed_weight,
 *      direction}` 으로 미리 분해하면 `normalize_matrix` 의 cost 반전과 이중으로
 *      걸려 조용히 뒤집히고, `direction_source` 가 산출물에서 사라진다.
 *    - 409 는 실패가 아니라 **점유**다 — 같은 도메인을 다른 run 이 잡고 있다.
 *
 * ✅ **run 목록 API 는 이제 있다**(2026-08-14). 여기 「아직 없다 — **405 Method Not
 *    Allowed**」라고 적혀 있던 문단을 지운다. 그때(2026-08-12)는 참이었다: `GET`
 *    핸들러가 없어 `POST /runs` 가 경로만 점유했고, 그래서 404 가 아니라 405 였다.
 *    지금은 `:96` 에 `@router.get("/runs")` 가 있다 — **405 는 이제 안 나온다.**
 *    낡은 주석을 남겨두면 다음 사람이 「목록을 못 물어본다」를 전제로 화면을 짠다.
 *
 * 🔴 **대신 401 이 나온다.** 이 라우트만 `Depends(get_current_user)` 라 **인증이
 *    필수**다(`POST /runs` 는 선택적 인증이라 익명도 202 를 받는다 — 같은 파일의
 *    두 라우트가 서로 다르다). 그래서 실패 갈래가 셋이다:
 *      401 = 토큰 없음/만료  ·  400 = `mine` 이 `"true"` 가 아님  ·  200 = 정상
 *    「목록이 비었다」와 「로그인이 필요하다」는 다른 문장이다. 마이페이지는 실패를
 *    삼키지 않고 사유를 그대로 띄운다.
 *
 * 🔴 **그래도 `runStore.ts` 는 남는다.** 목록이 생겼다고 브라우저 기억이 필요
 *    없어지는 게 아니다 — ⓐ 로그인 안 한 사람에겐 401 이라 목록 자체가 없고
 *    ⓑ 익명으로 만든 run 은 주인이 없다(백엔드 설계상 `user_id` 는 영구 nullable).
 *    브라우저에 남은 id 는 예나 지금이나 **서버에 되물어 확인한 뒤** 쓴다.
 */
import { deleteVoid, getJson, postJson, getText } from "./client";
import { parseCsv } from "./csv";
import { directUrl } from "./simulation";
import type {
  ArtifactName,
  AuditAnswer,
  CleanReportDoc,
  ExclusionDoc,
  FacilityInference,
  ReportDoc,
  ReviewedDoc,
  RunDoc,
  ScoreGridDoc,
  TopNCsvRow,
  WeightAnswer,
  WeightSetDoc,
} from "./types";

const BASE = "/api/v1/pipeline";

export interface RunMeta {
  run_id: string;
  domain: string;
  mode: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  is_mine: boolean;
}

/**
 * 계약 2절 · 8절. `mode` 는 이 **셋**이다.
 *
 * - `fixture` 무입력 완주. 회귀 검증용. 게이트가 **안 선다.**
 * - `hitl`    게이트A·B 에서 멈춘다. 화면 2 · 3 에서 답해야 이어진다.
 * - `full`    STEP0(프로파일링)부터 DB 적재까지 10칸. 업로드한 도메인 전용.
 *
 * 🔴 **`fixture`·`hitl` 은 `datasets/<도메인>_FIX/` 픽스처를 요구한다.**
 *    없으면 `POST /runs` 가 400 이다. 화면은 `GET /upload/domains` 의
 *    **`has_fixture`** 로 미리 알린다 — 그 판정은 **서버가 러너 자신의
 *    사전검사로** 낸 것이라(`upload.py:302`) 흉내가 아니다.
 *    ⚠ 미리 알리는 것과 **막는 것은 다르다.** 실행이 400 이면 그때는
 *      **서버 문구를 그대로** 띄운다 — 프런트가 사유를 지어내면 갈린다
 *      (응답에 사유 자체가 없다. 저장소 절대경로가 새기 때문에 뺐다).
 *    ⚠ 예전엔 여기에 「응답에 픽스처 유무가 없다」고 적혀 있었다. 필드가
 *      생긴 뒤에도 이 문장이 남아, **있는 값을 안 읽는 근거**가 됐다.
 *
 * 🔴 **`full` 에는 게이트가 있다.** `_PLAN[MODE_FULL]` 에 `gate:audit`·
 *    `gate:weight` 가 들어 있다.
 *    ⚠ 예전엔 여기에 「즉 업로드 경로에는 자동 완주가 **없다**」고 적혀 있었다.
 *      전제는 지금도 참이지만 결론은 틀렸다 — 게이트가 있다고 사람이 꼭 답해야
 *      하는 것은 아니다. `auto_approve` 가 **그 자리에서 AI 제안값으로** 답한다
 *      (게이트를 계획에서 빼는 것이 아니다). 아래 `MODE_FIXTURE` 와 헷갈리지 말 것:
 *      fixture 는 **픽스처 재생**(`<도메인>_FIX/` 필요)이지 자동승인이 아니다.
 *
 * 🔴 목록을 프런트가 정하지 않는다 — 서버가 모르는 값을 보내면 400 이고 문구도
 *    서버가 준다. 여기 있는 세 상수는 **버튼 라벨을 붙이기 위한 것**이지 화이트
 *    리스트가 아니다. (모드가 늘면 서버가 먼저 알고, 화면은 그다음이다)
 */
export const MODE_FIXTURE = "fixture";
export const MODE_HITL = "hitl";
export const MODE_FULL = "full";

/**
 * `full` 전용 실행 조건 (계약 8-2).
 *
 * 🔴 **다른 모드에서 보내면 400 이다.** 받아놓고 안 쓰는 인자를 만들지 않으려고
 *    백엔드가 일부러 막아뒀다 — 호출자가 "반영됐다" 고 읽으면 안 되기 때문이다.
 *    그래서 `createRun` 이 mode 를 보고 넣을지 말지 정한다.
 */
export interface FullParams {
  /**
   * 사용자 의도. STEP0.5 가 여기서 시설·지역을 확정한다. 빈 값 → 400.
   *
   * 🔴 화면1 은 여기에 「시설 유형」·「분석 지역」을 괄호로 **붙여서** 보낸다.
   *    그 꼬리도 아래 {@link USER_INPUT_MAX} 를 같이 먹는다 — 별도 예산이 아니다.
   */
  user_input: string;
  /** STEP4 가 뽑을 후보 개수 = 화면4 목록 길이. 서버 기본 20 · 범위 1~200. */
  topn?: number;
}

/** 계약 8-2 의 `topn` 기본값. 서버(`TOPN_DEFAULT`)와 같은 값이다. */
export const TOPN_DEFAULT = 20;
/** 계약 8-2 의 상한. 벗어나면 서버가 400. */
export const TOPN_MAX = 200;

/**
 * `user_input` 글자 수 상한.
 *
 * 🔴 **OpenAPI 에는 안 나온다.** `RunRequest.user_input` 은 `str | None` 이라
 *    `maxLength` 가 없고, 검사는 러너(`pipeline_runner.py` `_validate_full_params`)에
 *    있다. 스키마만 보고 「제한 없음」으로 읽으면 틀린다 — 실제로 한 번 그렇게
 *    읽고 화면에서 이 문구를 지웠다가 되살렸다(2026-08-24).
 *
 * 🔴 **바이트가 아니라 글자 수다.** 파이썬 `len()` 이 코드포인트를 세므로 한글도
 *    1자다. UTF-8 3배를 걱정해 160자쯤에서 막으면 멀쩡한 입력을 막는 것이다.
 *    세는 시점은 **`strip()` 후**다.
 *
 * 운영 실측(2026-08-24, `EV 충전소` 도메인에 201자):
 *   `400 {"detail":"user_input 이 너무 깁니다(201자, 상한 200)."}`
 * 이 400 은 run 생성 **전**이라 run_id·폴더·`run_records` 가 안 생긴다.
 * 그래서 부수효과 없이 찔러 볼 수 있었다.
 */
export const USER_INPUT_MAX = 200;

/**
 * `GET /pipeline/runs` 응답 (계약 §3-3).
 *
 * 🔴 **`runs` 는 전부가 아니다.** 서버가 `?limit=`(기본 100 · 범위 1~500)로 자르고,
 *    잘렸다는 사실을 `truncated` 로 알린다. 화면이 이걸 안 적으면 사용자는
 *    **옛 run 이 지워진 줄 안다** — 실제로는 안 물어봤을 뿐이다(절대원칙 4).
 *
 * ⚠ `limit` 인자는 **일부러 안 받는다.** 지금 화면에 그 값을 정할 자리가 없어서
 *   받아놓고 안 쓰는 인자가 된다(위 `FullParams` 주석과 같은 이유).
 *   「더 보기」를 붙이는 날 같이 연다.
 */
export interface RunListResponse {
  runs: RunMeta[];
  /** 서버가 아는 전체 건수. `runs.length` 와 다를 수 있다. */
  total: number;
  /** 이번에 적용된 상한. */
  limit: number;
  /** `total > limit` 이라 잘렸다. */
  truncated: boolean;
}

export async function fetchRuns(mine: boolean = true): Promise<RunListResponse> {
  return getJson<RunListResponse>(`${BASE}/runs?mine=${mine}`);
}

export async function createRun(
  domain: string,
  mode: string = MODE_FIXTURE,
  full?: FullParams,
  autoApprove: boolean = false,
): Promise<string> {
  // full 이 아닌데 조건을 들고 있으면 **여기서 버린다.** 그대로 보내면 400 이고,
  // 사용자에겐 "의도를 적었는데 서버가 거부했다" 로 보인다 — 화면이 안 보낼 값을
  // 입력받고 있었다는 게 진짜 사유다. 그건 화면 쪽에서 막는다(page.tsx).
  const body: Record<string, unknown> = { domain, mode };
  if (mode === MODE_FULL && full) {
    body.user_input = full.user_input;
    if (full.topn !== undefined) body.topn = full.topn;
  }
  // 🔴 `true` 일 때만 싣는다. `fixture` 는 게이트가 없어 서버가 **400** 으로 막는데,
  //    `false` 를 늘 실으면 그 400 이 「자동승인을 요청했다」로 읽힌다(원칙 4).
  if (autoApprove) body.auto_approve = true;
  const { run_id } = await postJson<{ run_id: string }>(`${BASE}/runs`, body);
  return run_id;
}

/**
 * 게이트 답변. 응답은 **답변 직후의 status.json** 이므로 그대로 현재 run 으로 쓴다.
 *
 * 🔴 `gate_id` 를 인자로 받지 않고 함수를 둘로 나눈 이유 — 본문 모양이 완전히 다르고
 *    서버가 "지금 기다리는 게이트와 다른 gate_id" 를 400 으로 막는다. 하나로 합치면
 *    호출부에서 `body` 가 `any` 에 가까워지고, 잘못된 짝을 타입이 못 잡는다.
 */
export function submitAuditGate(runId: string, answer: AuditAnswer): Promise<RunDoc> {
  return postJson<RunDoc>(
    `${BASE}/runs/${encodeURIComponent(runId)}/hitl/audit`,
    answer,
  );
}

export function submitWeightGate(runId: string, answer: WeightAnswer): Promise<RunDoc> {
  return postJson<RunDoc>(
    `${BASE}/runs/${encodeURIComponent(runId)}/hitl/weight`,
    answer,
  );
}

export function fetchRun(runId: string): Promise<RunDoc> {
  return getJson<RunDoc>(`${BASE}/runs/${encodeURIComponent(runId)}`);
}

/**
 * 실행 취소 — `DELETE /runs/{run_id}` → **204**(본문 없음). 백엔드 계약 3-4.
 *
 * 🔴 **한때 없앴던 함수를 되살린 것이다.** 2026-08-12 에는 이 라우트가 정말로
 *    없었고(`/openapi.json` pipeline 5개 중 DELETE 없음), 그때의 구현은
 *    **세 겹으로 조용했다**: ⓐ 공통 `request()` 를 안 거쳐 `Authorization` 이
 *    안 붙었고 ⓑ 실패를 `console.warn` 으로 삼켰으며 ⓒ 애초에 405 밖에 못 받았다.
 *    즉 「취소했다」고 믿게 만들고 아무것도 안 했다(절대원칙 4).
 *    되살리면서 셋 다 뒤집었다 — `request()` 경유 · 실패는 던진다 · 라우트 실재를
 *    **배포 브랜치에서** 확인했다(`origin/back_deploy` `118d414`
 *    `app/api/v1/pipeline.py:178`, 2026-08-14 실측).
 *
 * 🔴 **자식 프로세스를 실제로 죽이고 나서** 204 가 온다(백엔드 `runner.cancel_run`).
 *    그래서 이 호출이 끝난 뒤에는 그 도메인이 풀려 있다 — 도메인 삭제를 먼저
 *    치면 「진행 중인 run 이 있다」 **409** 를 받는다. 순서가 곧 규칙이다.
 *
 * 🔴 실패 둘은 **정상 상태**이므로 호출부가 갈라야 한다:
 *      404 = 없는 run_id(폴더가 정리됐다) · 409 = 이미 끝난 run
 *    둘 다 「취소할 것이 없다」는 뜻이지 「취소에 실패했다」가 아니다.
 *    반대로 204 로 뭉뚱그리는 것도 거짓이다 — 백엔드가 일부러 갈라놨다.
 */
export function cancelRun(runId: string): Promise<void> {
  return deleteVoid(`${BASE}/runs/${encodeURIComponent(runId)}`);
}

/**
 * 실행 로그(`run.log`). 백엔드 커밋 `836455e`.
 *
 * - 실행 중에도 읽힌다. **락을 안 걸므로 마지막 줄이 잘려 있을 수 있다** —
 *   자식 프로세스 출력을 막지 않으려는 의도된 선택이다. 화면은 마지막 줄을
 *   특별 취급하지 않는다(잘린 줄도 그냥 그대로 보여준다. 감추면 거짓말이 된다).
 * - run 은 있는데 로그가 아직 없으면 **200 + 빈 본문**이다. 404 가 아니다 —
 *   404 로 하면 "없는 run"과 구분이 안 되기 때문이다. 그래서 빈 문자열은
 *   오류가 아니라 "아직 안 쌓였다" 로 읽는다.
 * - `tail` 은 N ≥ 1. **0 은 422** 다(전체를 뜻하지 않는다). 전체를 원하면 생략한다.
 *
 * 🔴 이 응답만 "가공하지 않고 그대로" 의 **예외**다. 절대경로·OS 계정명·API 키가
 *    마스킹돼서 나온다(`<repo>` · `<home>` · `<마스킹:VWORLD_API_KEY>`). 지운 자리에
 *    표시를 남기는 방식이라 로그가 원본인 척하지 않는다 — 그래서 화면도 이 사실을
 *    각주로 적는다. 마스킹된 값을 원본으로 오해해 디버깅하면 시간을 버린다.
 */
export function fetchRunLog(runId: string, tail?: number): Promise<string> {
  const q = tail && tail >= 1 ? `?tail=${tail}` : "";
  return getText(`${BASE}/runs/${encodeURIComponent(runId)}/log${q}`);
}

/**
 * 산출물 URL.
 *
 * 🔴 `run.artifacts[name]` 이 있으면 **그 값을 그대로 쓴다.** 우리가 조립하지
 *    않는다. 계약 4절이 "status.json 을 가공하지 않고 그대로 내보낸다"고
 *    한 이유가, 경로 규칙이 바뀌어도 프런트가 안 깨지게 하려는 것이다.
 *    `artifacts` 에 키가 없다는 것은 "그 산출물이 아직 없다"는 뜻이므로 null.
 */
export function artifactUrl(run: RunDoc, name: ArtifactName): string | null {
  return run.artifacts[name] ?? null;
}

/**
 * 산출물이 없으면 조용히 넘기지 않고 던진다. 화면이 "왜 비었는지"를 말해야 한다.
 *
 * 🔴 **받아오는 주소는 `directUrl` 로 감싼다** — 벽이 요청 크기에만 있는 게
 *    아니라 **응답 크기에도 있다**(백엔드 실측 2026-08-15). `candidates` 는
 *    `.gpkg` 15~25MB 라 경유 경로로는 **413 · 0바이트**로 잘린다:
 *
 *      직결  api.omnisite.o-r.kr/…/artifacts/candidates → 200 · 24,961,024 B · 0.45s
 *      경유  omnisite.o-r.kr/…/artifacts/candidates     → 413 · 0 B · x-amplify-status: true
 *
 * 🔴 **산출물 이름으로 갈라 걸지 않는다.** 「`candidates` 만 직결」로 짜면
 *    프런트가 「어느 키가 큰가」라는 규칙을 또 들고 있어야 하고, 산출물이
 *    늘면 그 규칙이 낡아서 **다음 큰 파일에서 똑같이 413** 이다. 여기 하나로
 *    막으면 그 규칙이 아예 없어진다.
 *
 * ⚠ `run.artifacts[name]` 값 자체는 **여전히 손대지 않는다**(`artifactUrl` 주석).
 *   서버가 준 경로를 그대로 두고 **오리진만 앞에 붙인다** — 경로 규칙이 바뀌어도
 *   안 깨진다는 계약 4절이 그대로 산다.
 * ⚠ 이건 **교차 출처**가 된다. `client.ts` 가 `credentials` 를 안 걸고 preflight
 *   가 `allow-headers: authorization` 로 200 이라 Bearer 가 그대로 간다
 *   (`/stakeholders/generate` 직결이 이미 같은 방식으로 돈다).
 */
function requireUrl(run: RunDoc, name: ArtifactName): string {
  const url = artifactUrl(run, name);
  if (!url) {
    throw new Error(
      `산출물 '${name}' 이 run ${run.run_id} 에 없습니다 ` +
        `(상태: ${run.status}). 아직 생성 전이거나 실행이 실패했습니다.`,
    );
  }
  return directUrl(url);
}

export const loadReviewed = (run: RunDoc) =>
  getJson<ReviewedDoc>(requireUrl(run, "reviewed"));

/**
 * 시설·지역만 담긴 STEP 0.5 산출물. `reviewed.facility_inference` 와 **같은 값**이고
 * 다른 것은 시점뿐이다 — 이건 프로파일링 직후(~15초), 저건 감리 뒤(~240초).
 *
 * 🔴 `full` 에만 있다. fixture·hitl 은 STEP0-1 을 안 돌아 이 키가 `null` 이므로
 *    호출부는 반드시 `reviewed.facility_inference` 로 되짚어야 한다. 안 되짚으면
 *    프리셋 run 의 「선정 대상」이 통째로 빈다.
 */
export const loadFacility = (run: RunDoc) =>
  getJson<FacilityInference>(requireUrl(run, "facility"));

export const loadCleanReport = (run: RunDoc) =>
  getJson<CleanReportDoc>(requireUrl(run, "clean_report"));

export const loadWeightSet = (run: RunDoc) =>
  getJson<WeightSetDoc>(requireUrl(run, "weight_set"));

export const loadReport = (run: RunDoc) =>
  getJson<ReportDoc>(requireUrl(run, "report"));

export const loadScoreGrid = (run: RunDoc) =>
  getJson<ScoreGridDoc>(requireUrl(run, "score_grid"));

/**
 * 배제 레이어. **화면 2b 의 「최종 판정」 열은 이 파일에서만 나온다** —
 * `reviewed.json` 에는 감리 AI 제안(`exclusion_type`)만 있고, S9 지목 배수 판정이
 * 그걸 뒤집은 결과는 여기에 있다.
 *
 * 🔴 **좌표도 읽는다**(2026-08-12 부터). 예전 주석은 "GeoJSON 이지만 좌표는 안 읽는다 —
 *    화면 2b 가 쓰는 것은 `properties` 뿐이고 285KB 를 판정 표 하나 때문에 받는 셈"
 *    이었다. 그때는 참이었다. 지금은 **화면 4 지도가 이 좌표로 배제 구역을 그린다**
 *    (`GridMap` 3번 — 격자 사각형 근사를 대신한다).
 *
 *    그래서 "속성만 담긴 요약 산출물을 따로 만들자"는 예전 갈림길은 **닫혔다.**
 *    좌표가 실제로 쓰이므로 통째로 받는 것이 낭비가 아니다.
 *    실측(`r_20260812_007`): 285,174 bytes · 54ms · MultiPolygon 5장 · 링 491 · 점 6,253.
 */
export const loadExclusion = (run: RunDoc) =>
  getJson<ExclusionDoc>(requireUrl(run, "exclusion"));

/**
 * Top-N. **CSV 로 읽는다** — `report.json > topn[]` 에는 경도·위도가 없다(실측).
 * 지도에 찍으려면 이쪽이어야 한다.
 */
export async function loadTopN(run: RunDoc): Promise<TopNCsvRow[]> {
  const text = await getText(requireUrl(run, "topN"));
  return parseCsv(text).map((r) => ({
    parcel_idx: num(r, "parcel_idx"),
    from_rep: bool(r, "from_rep"),
    PNU: str(r, "PNU"),
    JIBUN: str(r, "JIBUN"),
    지목: str(r, "지목"),
    면적: num(r, "면적"),
    내접폭: num(r, "내접폭"),
    법정동코드: str(r, "법정동코드"),
    국유_건수: num(r, "국유_건수"),
    국유_지분면적: num(r, "국유_지분면적"),
    국유_지분율: num(r, "국유_지분율"),
    국유_지번일치: bool(r, "국유_지번일치"),
    점수: num(r, "점수"),
    커버기여: num(r, "커버기여"),
    누적커버율: num(r, "누적커버율"),
    순위: num(r, "순위"),
    경도: num(r, "경도"),
    위도: num(r, "위도"),
  }));
}

// ── CSV 셀 변환 ────────────────────────────────────────────────
// 🔴 없는 열을 0 이나 "" 로 때우지 않는다. 열 이름이 바뀌면 **터져야** 한다.
//    조용히 0 이 들어가면 지도에 (0, 0) 마커가 찍히고 아무도 눈치채지 못한다.

function cell(r: Record<string, string>, k: string): string {
  const v = r[k];
  if (v === undefined) {
    throw new Error(
      `topN.csv 에 '${k}' 열이 없습니다. 실제 열: ${Object.keys(r).join(", ")}`,
    );
  }
  return v;
}

const str = (r: Record<string, string>, k: string) => cell(r, k);

function num(r: Record<string, string>, k: string): number {
  const v = Number(cell(r, k));
  if (!Number.isFinite(v)) {
    throw new Error(`topN.csv '${k}' 열이 숫자가 아닙니다: ${JSON.stringify(r[k])}`);
  }
  return v;
}

/** pandas 가 쓴 파이썬 불리언. `True` / `False` 다 — 소문자가 아니다. */
function bool(r: Record<string, string>, k: string): boolean {
  const v = cell(r, k).trim();
  if (v === "True" || v === "true" || v === "1") return true;
  if (v === "False" || v === "false" || v === "0") return false;
  throw new Error(`topN.csv '${k}' 열이 불리언이 아닙니다: ${JSON.stringify(v)}`);
}
