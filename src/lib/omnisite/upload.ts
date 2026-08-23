/**
 * 화면 1(업로드) API — 백엔드 2026-08-09 재작성판.
 * ================================================
 * 근거: `app/api/v1/upload.py` (라인은 각 함수 주석에). 라우트는 **8개**이고
 * **전부 `domain` 이 필수**다. 도메인이 없으면 어느 파이프라인의 입력인지
 * 정할 수 없어서 서버가 받지 않는다(`upload.py:12`).
 * (7 → 8 은 `DELETE /domains/{domain}` — 도메인 초기화. 2026-08-14)
 *
 * 🔴 옛 판(`uploads/regulations/`)은 **파이프라인이 안 읽는 곳**에 저장했다.
 *    올려도 STEP1 감리가 못 봤고 200 이 떨어져서 안 걸렸다. 지금은
 *      조례   → `datasets/user_input/<도메인>/law/`
 *      데이터 → `datasets/user_input/<도메인>/data/`
 *    프런트가 경로를 알 필요는 없지만, 응답의 `saved_to` 를 **화면에 남긴다** —
 *    "어디에 저장됐는지" 가 옛 판에서 틀렸던 바로 그 값이다(원칙 4).
 *
 * 🔴 **업로드 루트가 갈라졌다**(백엔드 2026-08-14, 커밋 `b59858a`). 여기 적힌
 *    `datasets/<도메인>/…` 는 **옛 경로**라 위에서 고쳤다 — 지금 업로드·삭제가
 *    닿는 곳은 `datasets/user_input/` **하나뿐**이고, `datasets/<도메인>/` 는
 *    배포 프리셋(읽기 전용)이다. **이름이 같아도 다른 폴더다.**
 *    막는 방식이 문지기가 아니라 **경로 자체**라, 프리셋 이름으로 업로드·삭제·
 *    파일목록을 치면 폴더를 못 찾아 **400** 이다(실측 — 전달문의 "404" 는 틀렸다.
 *    `upload.py:145 _dirs()` → `_validate_domain()`).
 *    ✅ **배포됐다** — `origin/back_deploy` `118d414`(2026-08-14 13:30:50 병합)에
 *      들어 있다. 「아직 없다(6커밋 뒤)」고 적어뒀던 건 그 병합 **전에** 잰 값이라
 *      지금은 틀리다. 배포 여부는 커밋 개수가 아니라 **조상 관계**로 잰다
 *      (`git merge-base --is-ancestor <feature> origin/back_deploy`).
 *    ⚠ 그래도 `root` 가 **없는 응답을 계속 다룬다** — 되돌리거나 옛 서버를 띄우면
 *      다시 나타나고, 그때 `undefined` 를 채워버리면 화면이 거짓말을 한다.
 */
import { deleteJson, getJson, postForm } from "./client";
import { directUrl } from "./simulation";

const BASE = "/api/v1/upload";

/**
 * **올리는 두 호출만** 백엔드를 직접 친다(`POST /regulation` · `POST /data`).
 * 목록·삭제는 그대로 rewrite 를 탄다 — 몸통이 없으니 걸릴 벽이 없다.
 *
 * 🔴 이유는 **느려서가 아니라 몸통 크기** 때문이다. 그리고 그 상한은
 *    **`Content-Type` 에 따라 다르다** — 같은 바이트 수로 대조한 값이다
 *    (백엔드 실측 2026-08-15, 우리 실측과 일치):
 *
 *      4,716,000 B · application/json     → 422 (오리진이 답했다 · server: nginx 있음)
 *      4,716,000 B · multipart/form-data  → 413 (오리진에 못 닿았다 · nginx 헤더 없음)
 *
 *      형식              통과 최대      차단 최소      실효 상한
 *      multipart        4,715,000 B   4,716,000 B   ≈ 4.71 MB
 *      json             5,990,000 B   6,000,000 B   ≈ 5.99 MB
 *
 *    설명은 추정이다(Lambda 이벤트에 바이너리는 base64 로 실리고 텍스트는 그대로
 *    실린다 — `6 MiB × 3/4 = 4,718,592 B` 가 실측 임계와 3KB 차이다). **숫자는
 *    실측**이니 설계는 숫자로 한다. 직결로 보내면 오리진 nginx 의
 *    `client_max_body_size 512m`(server 블록 → 전 경로 상속) 만 남고, 우리 실측으로
 *    **원본 20MB 가 앱까지 닿는다**.
 *
 * 🔴 **「6MB 밑으로 쪼개면 된다」는 틀리다.** 원본 5MB·5.9MB 는 이미 413 이다
 *    (우리 실측). multipart 기준은 6MB 가 아니라 **4.4MB** 다.
 * 🔴 그리고 그건 **파일 하나가 아니라 요청 바디 전체**다 — 다중 파일이면 합산이고
 *    multipart 경계·헤더도 같이 센다. 쪼갤 일이 생기면 **요청당 총합 4.4MB**.
 *
 * ⚠ 413 은 오리진에 **로그가 안 남는다** — 닿기 전에 잘리기 때문이다. 그래서
 *   백엔드 nginx 액세스로그에 413 이 0건인 것은 「없었다」가 아니라 **볼 수 없다**
 *   는 뜻이다. 「우리 쪽엔 400 뿐」을 근거로 벽이 없다고 판단하면 안 된다.
 * ⚠ 413 헤더에는 `server: nginx` 도 `x-amplify-status` 도 **없고** CloudFront
 *   헤더만 온다. 504(컴퓨트 타임아웃)와 판별자가 다르다 — 공통은 `server: nginx`
 *   **부재** 하나뿐이다.
 * ⚠ 직결이라 **교차 출처**다. `client.ts` 가 `credentials` 를 안 걸어서 preflight
 *   가 통과한다(OPTIONS 200 · `allow-headers: authorization` 실측). 여기에
 *   `credentials: "include"` 를 붙이면 조용히 전부 깨진다.
 */

/**
 * 파일 선택창 `accept` 힌트. **검증은 서버가 한다** — 여기 목록은 사용자가
 * 못 고르게 막는 편의일 뿐이고, 어긋나면 서버 400 문구를 그대로 보여준다.
 * (프런트가 따로 거절하면 그 문구가 서버 정책과 어긋난다)
 *
 * 근거: `upload.py:81`(조례) · `:90`(데이터). 실측으로 확인한 값이다.
 *   TEXT_EXT .txt .md / EXTRACTORS .pdf .docx .hwpx
 *   DATA_EXTENSIONS .csv .xlsx .xls .shp .json / SIDECAR .dbf .shx .prj .cpg .qpj .sbn .sbx
 *
 * 🔴 `.hwp`·`.doc` 는 **일부러 빠져 있다.** 추출기가 없어 받아도 0청크다.
 *    옛 판은 둘 다 허용해놓고 조용히 아무것도 적재하지 않았다.
 */
export const LAW_ACCEPT = ".txt,.md,.pdf,.docx,.hwpx";
export const DATA_ACCEPT =
  ".csv,.xlsx,.xls,.shp,.json,.dbf,.shx,.prj,.cpg,.qpj,.sbn,.sbx";

// ── 1. 도메인 목록 ────────────────────────────────────────────────

/** `GET /domains` 한 줄. `upload.py:229-264` */
export interface DomainItem {
  domain: string;
  /**
   * 이 행이 어느 루트에 있는가. `upload.py:DomainItem.root`
   *   `"upload"`  = `datasets/user_input/<도메인>` — 업로드·삭제가 닿는 유일한 곳
   *   `"preset"`  = `datasets/<도메인>` 배포 원본 — **목록에만 뜬다**
   *   `undefined` = **서버가 아직 이 필드를 모른다**(루트 분리 전 배포)
   *
   * 🔴 없는 것을 `"upload"`·`"preset"` 어느 쪽으로도 **채우지 않는다.**
   *    `"upload"` 로 치면 분리 전의 위험한 의미를 그대로 두면서 「업로드 가능」
   *    배지까지 달게 되고, `"preset"` 으로 치면 버튼이 전부 사라져 옛 서버에서
   *    화면이 통째로 먹통이 된다. 모르면 **모른다고 두고 예전처럼 그린다**
   *    (`f.deletable === undefined` 를 다루는 방식과 같다).
   * ⚠ 이름이 겹치면 서버가 **업로드 행만** 돌려준다 — 같은 이름의 프리셋 행은
   *   목록에서 사라진다. 「프리셋이 없어졌다」가 아니라 **가려진 것**이다.
   */
  root?: "upload" | "preset";
  law_files: number;
  data_files: number;
  /** STEP1 감리 확정본이 있는가 = `facility_type` 을 생략해도 되는가. */
  has_audit_reviewed: boolean;
  /**
   * `mode=fixture`·`hitl` 로 돌릴 수 있는가(= `<도메인>_FIX` 픽스처가 온전한가).
   * `false` 면 그 두 모드는 **400** 이다. `mode=full` 은 픽스처와 무관하다.
   *
   * 🔴 판정은 **서버가 러너 자신의 사전검사로** 한다(`upload.py:302`
   *    `fixture_blocker(name) is None`). 프런트가 「`_FIX` 폴더가 있으면 가능」 같은
   *    규칙을 흉내 내면 서버와 갈라진다 — 실제 조건은 폴더가 아니라 **파일 둘**이라
   *    폴더만 보면 "가능"이라 그려놓고 실행이 400 으로 죽는다.
   * ⚠ 막힌 **이유**는 응답에 없다(저장소 절대경로가 새기 때문). 그래서 화면도
   *   「안 된다」까지만 말하고 사유를 지어내지 않는다.
   * ⚠ 픽스처(`<도메인>_FIX`)는 **프리셋 루트에 산다** — 그 행의 `root` 와 무관하다.
   *   업로드 행에 `has_fixture: true` 가 뜨는 건 **정상**이고, 두 값을 묶어
   *   판단하면(예: 「업로드 행인데 픽스처가 있다니 이상하다」) 틀린다.
   */
  has_fixture: boolean;
  /**
   * 업로드 원장에 없는 파일 수(data+law) = **배포 원본**(프리셋 모드가 읽는 것).
   *
   * 🔴 0 보다 크면 이 도메인은 **이미 쓰이고 있는 폴더**다. 이름을 맞춰서 고르면
   *    남의 파일이 「내가 올린 것」처럼 보이고, 실제로 그렇게 보고 지워서
   *    `datasets/흡연/data` 가 통째로 사라진 적이 있다(2026-08-13).
   *    그래서 화면은 이 값이 0 이 아니면 **고르기 전에** 경고한다.
   *
   * 🔴 **`root` 에 따라 뜻이 다르다.** 프리셋 행은 서버가 원장을 빈 집합으로
   *    넘기므로(`upload.py:514-515`) 항상 `law_files + data_files` 와 같다 —
   *    즉 비어 있지 않은 프리셋 행은 **언제나 > 0** 이다. 「업로드 폴더에 남의
   *    파일이 섞였다」는 경고 문구를 그대로 쓰면 거짓이 된다(그 목록에는 애초에
   *    내 파일이 없다). 업로드 행에서만 그 뜻으로 읽는다.
   */
  preexisting_files: number;
}

/**
 * 도메인 목록 — **두 루트를 합친 것**(서버 기본값 `?root=all`).
 *
 * 이 호출이 먼저다 — 나머지 6개가 전부 `domain` 을 요구하므로 사용자가 직접
 * 타이핑하게 두면 오타가 곧 "없는 도메인" 400 이 된다.
 *
 * 🔴 **`?root=` 를 일부러 안 붙인다.** 서버는 `all`·`upload`·`preset` 을 받지만
 *    (그 외는 400), 화면1 의 프리셋 카드와 업로드 패널이 **이 한 번의 호출**을
 *    같이 쓴다 — 여기서 좁히면 프리셋 경로가 통째로 빈 화면이 되는데 **에러가
 *    안 난다**(200 + 빈 배열). 걸러야 하면 받아온 뒤 `root` 로 나눈다.
 *    ⚠ 인자를 안 만든 것은 「서버에 없어서」가 아니라 **이 이유** 때문이다 —
 *      나중에 필요해지면 지우지 말고 여기 근거부터 다시 읽을 것.
 */
export function fetchDomains(): Promise<DomainItem[]> {
  return getJson<DomainItem[]>(`${BASE}/domains`);
}

/** `DELETE /domains/{domain}` 응답. `upload.py:583-670` */
export interface DomainResetResult {
  status: string;
  domain: string;
  files_removed: number;
  bytes_removed: number;
  vector_chunks_removed: number;
  /** Redis 업로드 색인이 실제로 지워졌는가(없었으면 `false`). */
  redis_index_removed: boolean;
}

/**
 * 도메인 초기화 — 업로드 폴더를 **통째로** 지운다(data·law·원장·벡터 청크·Redis 색인).
 *
 * 🔴 **되돌릴 수 없다.** 그래서 부르는 쪽이 먼저 「무엇이 지워지는지」를 보여준다
 *    (`DomainItem.law_files`·`data_files`). 「초기화」라는 말만 띄우고 부르면
 *    사용자는 브라우저 상태만 지워지는 줄 안다.
 *
 * 🔴 **프리셋에는 닿지 않는다** — 이 라우터가 보는 루트가 `datasets/user_input/`
 *    뿐이라 문지기가 아니라 **경로상 불가능**하다. 프리셋 이름으로 부르면
 *    「업로드 도메인이 없습니다」 **404** 다. 그건 실패가 아니라 **지울 게 없다**는
 *    뜻이므로, 화면이 빨간 오류로 그리면 거짓이 된다.
 *
 * 🔴 실패 갈래를 접지 않는다. 뜻이 전부 다르고 다음 행동도 다르다:
 *      404 지울 게 없다(프리셋이거나 이미 정리됨) — 정상
 *      409 그 도메인으로 **진행 중인 run** 이 있다(queued·running·awaiting_hitl).
 *          🔴 여기에는 `force` 가 **없다**. 파일 삭제(`force=true`)의 409 와
 *             다른 물건이다 — 재시도 버튼을 달면 **영원히 성공할 수 없는**
 *             재시도가 되고, 성공해서도 안 된다(돌고 있는 run 의 입력이다).
 *             그 run 을 먼저 취소해야 한다(`cancelRun`).
 *      500 두 갈래다 — ⓐ 벡터 청크 삭제 실패 = **아무것도 안 지웠다**(그대로 다시
 *          시도하면 된다) ⓑ 폴더 삭제 실패 = **청크는 이미 지워졌다**(파일은 남고
 *          검색만 죽었으므로 다시 올려야 한다). 서버 `detail` 이 둘을 구분해
 *          적어주므로 **문구를 지어내지 말고 그대로 띄운다**.
 *
 * ⚠ 안 눌러도 서버가 **24시간 뒤 자동으로** 같은 것을 지운다(`user_input_pruner`).
 *   즉 이 버튼은 「쌓이는 걸 막는 유일한 수단」이 아니라 **지금 비우는 경로**다 —
 *   실패했다고 데이터가 영영 쌓이지는 않는다.
 */
export function resetDomain(domain: string): Promise<DomainResetResult> {
  return deleteJson<DomainResetResult>(
    `${BASE}/domains/${encodeURIComponent(domain)}`,
  );
}

// ── 2. 조례 ───────────────────────────────────────────────────────

/** `GET /regulations` 한 줄. `upload.py:270-275` */
export interface RegulationItem {
  filename: string;
  size: number;
  /** 텍스트 추출이 끝나 STEP1 이 읽을 수 있는가. `false` 면 저장은 됐지만 안 쓰인다. */
  text_ready: boolean;
  chunks_in_vector_db: number;
  /** `upload`(이 저장소를 통해 올린 것) | `preexisting`(폴더에 원래 있던 배포 원본). */
  source: string;
  /**
   * `false` 면 삭제에 `force=true` 가 필요하다(배포 원본).
   *
   * 🔴 **판정은 서버가 한다.** 프런트가 `source === "upload"` 를 다시 계산하면
   *    규칙이 두 곳이 되고, 어긋나면 화면은 지울 수 있다고 그려놓고 서버가 409 다.
   */
  deletable: boolean;
}

/**
 * 업로드 1건의 처리 결과. `upload.py:406-420`.
 *
 * 🔴 `ingested: false` 여도 **파일은 이미 저장돼 있다.** 서버가 그 사실을
 *    숨기지 않고 `warnings` 에 어디까지 됐는지 남긴다 — 화면도 숨기면 안 된다.
 */
export interface RegulationReport {
  filename: string;
  size: number;
  sha256: string;
  /** 같은 이름을 덮어썼는가. 덮어썼으면 옛 청크는 `deleted_old_chunks` 만큼 지워진다. */
  replaced: boolean;
  text_chars: number;
  articles: number;
  regulatory_articles: number;
  has_siting_provision: boolean;
  siting_signals: string[];
  chunks: number;
  deleted_old_chunks: number;
  ingested: boolean;
  warnings: string[];
}

/** `POST /regulation` 응답. `upload.py:491-506` */
export interface RegulationUploadResult {
  ok: boolean;
  domain: string;
  saved_to: string;
  /**
   * 🔴 **`null` 일 수 있다.** 요청이 안 보내고 STEP1 감리 확정본도 없으면 서버가
   *    못 정한다 — 그래도 업로드·적재·검색은 전부 정상이다(예전엔 이 경우가 400
   *    이었다). 화면에서 `null` 을 그대로 찍지 말 것.
   */
  facility_type: string | null;
  /**
   * `request`(요청이 준 값) · `audit_reviewed`(STEP1 확정본에서 읽음) ·
   * `unknown`(못 정함 — **정상 상태다**).
   */
  facility_type_source: string;
  law_files_total: number;
  files: RegulationReport[];
}

export function fetchRegulations(domain: string): Promise<RegulationItem[]> {
  const q = new URLSearchParams({ domain });
  return getJson<RegulationItem[]>(`${BASE}/regulations?${q.toString()}`);
}

/**
 * 조례 다중 업로드.
 *
 * 🔴 `facility_type` 을 **보내지 않는다.** 예전엔 필수였고 비면 **400** 이었다 —
 *    조례 벡터 콜렉션이 `statutes_collection` **하나**라 전 도메인 조문이 한 칸에
 *    섞였고, 그래서 검색이 이 태그 **정확일치**로 걸러야 했다. 즉 태그가 곧 격리
 *    키였다(2026-08-09 실측: 태그가 어긋나 흡연부스 토론 상위 15건 중 4건이
 *    전기차충전소 조례였다). 백엔드가 콜렉션을 **도메인마다** 갈랐으므로
 *    (`statutes_<도메인>`) 격리는 이제 구조가 맡고, 이 값은 사람이 보는
 *    부가정보로 내려갔다. 운영 스키마 실측(2026-08-24, `GET /openapi.json`):
 *    `required: ["domain", "files"]` · `facility_type: anyOf[string, null]`.
 *
 * 🔴 `ingest` 도 **보내지 않는다.** 기본이 `true` 인데 끄면 파일만 저장되고 토론이
 *    근거를 못 찾는다 — 사람이 고를 이유가 없는 값이라 칸째로 없앴다. 기본값에서
 *    적재 0건이면 서버가 **422** 로 거절한다 — "올렸는데 검색에 안 잡힘" 을
 *    성공으로 보이지 않게 하려는 것이라, 이 갈래는 그대로 살아 있다.
 */
export function uploadRegulations(opts: {
  domain: string;
  files: File[];
  createDomain?: boolean;
}): Promise<RegulationUploadResult> {
  const form = new FormData();
  form.set("domain", opts.domain);
  for (const f of opts.files) form.append("files", f);
  if (opts.createDomain !== undefined) form.set("create_domain", String(opts.createDomain));
  // 🔴 경로는 **단수** `/regulation` 이다. 복수 `/regulations` 는 GET(목록)·
  //    DELETE 전용이라 POST 로 치면 **405** 다(실측). 백엔드 전달문의
  //    「`/upload/regulations` 를 직결로」는 이 지점이 틀렸다.
  return postForm<RegulationUploadResult>(directUrl(`${BASE}/regulation`), form);
}

/** `DELETE /regulations/{filename}` 응답. `upload.py:550-556` */
export interface RegulationDeleteResult {
  status: string;
  domain: string;
  filename: string;
  extract_cache_removed: boolean;
  vector_chunks_removed: number;
}

/**
 * 조례 삭제 — 파일 + 추출 캐시 + 벡터 청크를 함께 지운다.
 *
 * 🔴 파일명은 `encodeURIComponent` 로 감싼다. 한글·공백·`#` 이 들어간 조례
 *    파일명이 실재한다. 서버도 `urllib.parse.unquote` 로 되돌린다(`upload.py:519`).
 */
export function deleteRegulation(
  domain: string,
  filename: string,
): Promise<RegulationDeleteResult> {
  const q = new URLSearchParams({ domain });
  return deleteJson<RegulationDeleteResult>(
    `${BASE}/regulations/${encodeURIComponent(filename)}?${q.toString()}`,
  );
}

// ── 3. 데이터 ─────────────────────────────────────────────────────

/**
 * `dataset_id` 재번호 1건. `upload.py:1022-1043`(`_renumbered`).
 *
 * 🔴 **이게 이 화면에서 제일 중요한 값이다.** `dataset_id` 는 파일명 가나다순이라
 *    앞 번호로 파일 하나가 끼어들면 뒤 번호가 **전부 밀린다**. 이미 돌린
 *    감리 결과·정제 캐시의 번호와 어긋나고, 그러면 감리 결과가 **엉뚱한 파일에
 *    붙는다** — 안 터지고 값만 틀린다. 화면에서 접으면 안 된다.
 *
 * 🔴 담기는 것은 **원래 있던 번호가 딴 파일을 가리키게 된 것뿐**이다. 판정은
 *    서버 한 곳(`did in before and before[did] != after[did]`)에 있고 프런트가
 *    다시 거르지 않는다. **신규 배정은 안 들어온다** — 옛 결과가 참조할 수 없는
 *    번호라 위험이 없다. 번호↔파일 대응 전량은 `dataset_map` 이 따로 들고 있고,
 *    화면에는 목록의 `dataset_id` 칸으로 이미 그려진다.
 */
export interface Renumbered {
  dataset_id: string;
  /**
   * 이 번호가 **가리키던** 파일. 위 판정이 `did in before` 로 막아서 `null` 이
   * 될 수 없다(백엔드 `ba42ad2` 2026-08-16).
   *
   * ⚠ 예전엔 `before.get(did) != after[did]` 하나로 걸렀다. 빈 도메인 첫
   *   업로드는 `before == {}` 라 `None != "<파일명>"` 이 전건 참이 되어 **신규
   *   배정이 전부 「밀림」으로 보고**됐다. 업로드 모드의 가장 흔한 경로라 거의
   *   매번 빨간 상자가 떴는데, **늘 켜진 경고등은 꺼진 것과 같다** — 진짜
   *   밀림까지 같이 흘려보낸다. 그래서 이 필드가 `string | null` 이었고 화면에
   *   `(없음)` 폴백이 있었다. 서버가 고쳐졌으므로 둘 다 걷었다.
   */
  before: string;
  after: string;
}

/** 데이터 파일 1건의 메타. `upload.py:628-638`(업로드) · `:715-733`(목록) */
export interface DataFile {
  filename: string;
  domain: string;
  ext: string;
  size: number;
  /** 업로드를 안 거치고 폴더에 직접 놓인 파일은 `null` 이다 — "모른다" 를 0 으로 채우지 않는다. */
  sha256: string | null;
  /** 부속 파일(.dbf 등)은 dataset 이 아니다. */
  is_dataset: boolean;
  uploaded_at?: string | null;
  /**
   * 목록 응답에만 있다. `upload` | `preexisting`.
   *
   * 🔴 판정 정본은 **디스크 원장**(`datasets/<도메인>/.upload_ledger.json`)이다.
   *    예전엔 Redis 색인의 sha256 유무로 판정했는데, TTL(30일)·`volatile-lru`
   *    로 걷히면 **내가 올린 파일이 「폴더에 있던 것」으로 바뀐다**.
   */
  source?: string;
  /** 목록 응답에만 있다. `false` 면 삭제에 `force=true` 가 필요하다(배포 원본). */
  deletable?: boolean;
  /** 목록 응답에만 있다. 부속 파일이면 `null`. */
  dataset_id?: string | null;
  replaced?: boolean;
  path?: string;
}

/** `POST /data` 응답. `upload.py:661-675` */
export interface DataUploadResult {
  ok: boolean;
  domain: string;
  saved_to: string;
  files: DataFile[];
  dataset_count: number;
  /** `{"01": "파일명", ...}` — 현재 폴더 상태의 dataset_id 배치. */
  dataset_map: Record<string, string>;
  renumbered: Renumbered[];
  /** 재번호가 있을 때만 문자열. 없으면 `null`. */
  warning: string | null;
}

/** `GET /data` 응답. `upload.py:736-744` */
export interface DataListResult {
  domain: string;
  data_dir: string;
  dataset_count: number;
  dataset_map: Record<string, string>;
  redis_key: string;
  /**
   * Redis 색인에는 있었는데 디스크에 없어서 지운 항목.
   *
   * 서버는 매 조회마다 **디스크(정본) ↔ Redis(색인)** 를 대조하고 그 결과를
   * 숨기지 않는다(`upload.py:683-687`). 비어 있지 않으면 화면에도 남긴다 —
   * 색인만 보고 답하면 지워진 파일이 계속 있는 것처럼 보인다.
   */
  redis_stale_removed: string[];
  files: DataFile[];
}

export function fetchDataFiles(domain: string): Promise<DataListResult> {
  const q = new URLSearchParams({ domain });
  return getJson<DataListResult>(`${BASE}/data?${q.toString()}`);
}

/**
 * 감리용 데이터 다중 업로드.
 *
 * 🔴 `_`·`.` 로 시작하는 파일은 서버가 **400 으로 거절**한다 — 프로파일러가
 *    부속·숨김으로 보고 건너뛰기 때문이다(`upload.py:614-622`). 받아놓고
 *    안 쓰면 거짓말이라서 아예 안 받는다.
 *
 * `.shp` 는 `.dbf`·`.shx`·`.prj` 없이는 못 읽는다. 부속도 같은 호출에 함께
 * 넣을 수 있고, 부속은 `is_dataset: false` 로 온다.
 */
export function uploadDataFiles(opts: {
  domain: string;
  files: File[];
  createDomain?: boolean;
}): Promise<DataUploadResult> {
  const form = new FormData();
  form.set("domain", opts.domain);
  for (const f of opts.files) form.append("files", f);
  if (opts.createDomain !== undefined) form.set("create_domain", String(opts.createDomain));
  return postForm<DataUploadResult>(directUrl(`${BASE}/data`), form);
}

/** `DELETE /data/{filename}` 응답. `upload.py:775-787` */
export interface DataDeleteResult {
  status: string;
  domain: string;
  filename: string;
  dataset_count: number;
  dataset_map: Record<string, string>;
  renumbered: Renumbered[];
  warning: string | null;
}

/** 데이터 삭제. 지운 뒤 **남은 파일의 번호가 어떻게 밀리는지**를 같이 받는다. */
export function deleteDataFile(
  domain: string,
  filename: string,
): Promise<DataDeleteResult> {
  const q = new URLSearchParams({ domain });
  return deleteJson<DataDeleteResult>(
    `${BASE}/data/${encodeURIComponent(filename)}?${q.toString()}`,
  );
}
