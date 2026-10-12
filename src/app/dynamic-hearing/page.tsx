"use client";

/**
 * 화면 5-B — 다인(N명) 토론.
 * ==========================
 * 화면 5 는 토론 방식이 둘이다. 이 화면은 **B(이해관계자 페르소나 N명)** 이고,
 * A(찬반 대립)는 `/hearing` 이다. 백엔드도 엔진이 둘로 갈려 있다
 * (`app/core/stakeholder_mode/` ↔ `app/core/sim_ai/`). 어느 쪽으로 갈지는
 * `/hearing/select` 에서 고른다(2026-08-11 신설) — 이 화면은 **고르고 난 뒤**다.
 *
 * 🔴 **입력은 A 와 같아야 한다** — 화면 4 에서 사람이 고른 그 점. 병합 당시 이
 *    화면은 좌표를 `{ lat: 37.5665, lng: 126.9780, region: "테스트 지역" }` 로,
 *    조례를 `["서울특별시 간접흡연 피해방지조례 제5조"]` 로 **코드에 박고**
 *    있었다. 둘 다 실행 결과가 아니라 지어낸 값이고, 그 값으로 LLM 이 페르소나를
 *    뽑고 토론을 완주하면 화면에는 **정상 결과로 보인다**(원칙 2·4).
 *    지금은 `useSelectedSite()` 로 A 와 같은 배선을 쓴다 —
 *    도메인·`loaded.run_id`·`/candidates`·`PNU` 조인·못 이으면 정지.
 *
 * 🔴 **위치·조례 문맥을 이제 안 보낸다**(2026-08-11 계약 변경). 두 요청 본문이
 *    `parcel_id` + 사람이 쓴 값(`topic`·`purpose`·`personas`)으로 좁아졌고,
 *    나머지는 서버가 `parcel_id` 로 조달한다 — A 와 **같은 함수**로 조달하므로
 *    두 엔진이 다른 근거로 토론하는 일이 없어진다. 보내면 400 이다.
 *    화면에 뜨는 위치·조례 문맥 건수(`gisData`·`ordinanceContexts`)는 그대로 —
 *    사람이 무엇을 보고 시작하는지는 여전히 보여야 한다.
 *
 * 조례 문맥은 지어내지 않는다. STEP1 산출물(`reviewed`)의 근거문장을 세어 화면에
 * 적고, 하나도 없으면 **없다고 적는다.**
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Info, Users, MessageSquare } from "lucide-react";

import { PageBody, PageFooter, PageHeader, SourceNote } from "@/components/ui/Page";
import { SCREENS } from "@/lib/omnisite/screens";
import { ApiError, NetworkError, postJson } from "@/lib/omnisite/client";
import { loadReviewed } from "@/lib/omnisite/pipeline";
import { useArtifact } from "@/lib/omnisite/useArtifact";
import { useSelectedSite, type Failure } from "@/lib/omnisite/useSelectedSite";
import { FIRST_PACKET_TIMEOUT_MS, IDLE_TIMEOUT_MS, directUrl } from "@/lib/omnisite/simulation";
import {
  readPersonas,
  writePersonas,
  type Persona,
  type PersonaScope,
} from "@/lib/omnisite/personaCache";
import { writeHearingB } from "@/lib/omnisite/hearingResult";
import { DEMO, demoDiscussInputs } from "@/lib/omnisite/demo";
import type { ReviewedDoc } from "@/lib/omnisite/types";

import { SetupStep } from "./_components/SetupStep";
import { PersonaStep } from "./_components/PersonaStep";
import { DiscussionStep } from "./_components/DiscussionStep";

const SCREEN = SCREENS.find((s) => s.no === "5")!;

/**
 * 🔴 **둘 다 백엔드를 직접 부른다** — 둘 다 30초를 넘기 때문이다. 근거 전부는
 *    `simulation.ts` 의 `BACKEND_ORIGIN` 머리주석에 있다. Amplify compute 가
 *    응답을 버퍼링하다 30초 벽에서 본문 없는 오류를 만드는데, 토론은 실측
 *    **55.7초**, 페르소나 발굴은 실측 **29.2초에 200 · 30.0초에 실패**다.
 *
 * 🔴 `/generate` 는 **한 번 빼먹었다가 그대로 터진 자리다**(2026-08-15). 여기
 *    주석이 「SSE 가 아니라 한 번에 받는 JSON 이라 버퍼링이 무해하다」고 적고
 *    남겨 뒀는데, 사용자 화면에 **「페르소나를 발굴하지 못했습니다 / HTTP 504
 *    (본문 없음)」** 이 떴다. 응답이 스트림이냐 단발이냐는 상관이 없다 —
 *    **버퍼링은 걸린 시간에만 반응한다.**
 *
 * ⚠ `credentials: "include"` 를 붙이지 말 것. 응답의 `access-control-allow-origin`
 *   이 `*` 라 브라우저가 credentials 모드에서 거부한다. 지금 두 호출 다 쿠키·
 *   `Authorization` 을 안 싣는다.
 */
const GENERATE_URL = directUrl("/api/v1/stakeholders/generate");
const DISCUSS_URL = directUrl("/api/v1/stakeholders/dynamic/discuss/stream");

/** 백엔드 `StakeholderCandidate` 그대로. 전부 필수거나 기본값이 있다(스키마 확인). */
interface StakeholderCandidate {
  display_name: string;
  stakeholder_type: string;
  relationship_to_topic: string;
  recommendation_reason: string;
  importance_grade: string;
  keywords: string[];
}

/**
 * B 스트림 이벤트 한 건. **평평한 모양**이다(2026-08-11 백엔드 정규화).
 *
 * 🔴 예전엔 LangGraph `astream(stream_mode="updates")` 원형
 *    (`{노드이름: {상태변화}}`)이 그대로 나왔고, **내부 노드 이름이 곧 프런트
 *    계약**이었다. 발화자는 프런트가 `"): "` 로 **문자열을 잘라** 되찾았는데,
 *    표시 이름에 `)` 나 `:` 가 들어가면(예: `주민 (A동): 대표`) 조용히 잘못
 *    잘린다 — 안 터지고 이름만 틀린다. 그 파싱은 전부 버렸다.
 *
 * 여기 안 적은 필드는 **추측해서 자리를 만들지 않는다.** 백엔드가 뜻을 모르는
 * 노드·키를 `type: "raw"` 로 그대로 내보내므로, 미리 칸을 파 두면 그 칸이
 * 계약이 되어 버린다.
 */
interface StreamEvent {
  type?: unknown;
  node?: unknown;
  seq?: unknown;
  /** `message` — 백엔드가 자기 접두사와 **완전 일치**로만 가른 결과다. */
  speaker?: { id?: unknown; name?: unknown; kind?: unknown };
  text?: unknown;
  /** 사회자 발언에만. 빈 말풍선을 안 만들려고 다음 발화자를 같이 준다. */
  next_speaker?: unknown;
  /** `evaluation` */
  round?: unknown;
  acceptance?: unknown;
  css_levels?: unknown;
  /** `report` */
  final_scenarios?: unknown;
  is_finished?: unknown;
  /** `saved` — 서버가 `hearing_results_b` 에 남긴 행. `result_url` 은 조회 경로 **원문**이다. */
  hearing_id?: unknown;
  result_url?: unknown;
  /** `save_failed` — 저장 실패 사유 원문. (스트림 자체의 `error` 는 호출부에서 먼저 걸러진다) */
  error?: unknown;
}

/**
 * 화면에 뜨는 발화 1건.
 *
 * `kind` 는 백엔드가 준 값을 **그대로** 옮긴 것이다(`persona`·`moderator`·
 * `factchecker`·`unknown`). 이름으로 `includes("system")` 같은 추측을 하지
 * 않으려고 들고 다닌다 — 그 추측은 사람 이름에 우연히 걸린다.
 */
interface ChatLine {
  speaker: string;
  text: string;
  kind?: string;
}

/**
 * 오른쪽 「실시간 쟁점 요약」이 읽는 값. **어휘는 백엔드 이벤트 그대로**다
 * (`round`·`acceptance`·`css_levels`·`final_scenarios`). 여기서 이름을 새로
 * 지으면 서버 문서와 화면이 갈려, 값이 안 뜰 때 어느 쪽을 볼지 알 수 없다.
 */
type DiscussionStatus = {
  round: number | null;
  acceptance: Record<string, number>;
  css_levels: Record<string, string>;
  /** `report` 이벤트의 `final_scenarios` 원문. 키를 추리지 않는다. */
  report: Record<string, unknown> | null;
  is_finished: boolean;
};

const EMPTY_STATUS: DiscussionStatus = {
  round: null,
  acceptance: {},
  css_levels: {},
  report: null,
  is_finished: false,
};

/**
 * `source` 자리에 조항이 아닌 **리터럴**이 오는 경우들. 백엔드 산출물이 이 한 칸에
 * 두 의미를 담고 있어서(조항 문자열 ↔ 확정 방식) 걸러야 한다 — 이걸 조례 문맥으로
 * 넘기면 LLM 에게 「human_confirmed」라는 조례가 있다고 말하는 셈이다.
 */
const NON_CITATION_SOURCES = new Set([
  "human_confirmed",
  "llm",
  "fixture",
  "cli",
  "none",
  "default",
  "auto_confirmed",
]);

/**
 * 조례 문맥을 STEP1 산출물에서 모은다. **없으면 빈 배열이다** — 예시 조문을
 * 채워 넣지 않는다. 근거문장(`hitl_flags[].근거문장`)이 1순위고, 배제 규칙의
 * `source` 는 리터럴을 걷어낸 것만 쓴다.
 */
function collectOrdinanceContexts(doc: ReviewedDoc | null): string[] {
  if (!doc) return [];
  const out = new Set<string>();
  for (const r of doc.results) {
    for (const f of r.hitl_flags) {
      const s = f.근거문장?.trim();
      if (s) out.add(f.출처?.trim() ? `${f.출처.trim()} — ${s}` : s);
    }
    for (const role of r.roles) {
      const s = role.source?.trim();
      if (s && !NON_CITATION_SOURCES.has(s)) out.add(s);
    }
  }
  return [...out];
}

/**
 * `{키: 숫자}` 만 걸러 낸다. 숫자가 아닌 값은 **버리고 로그를 남긴다** —
 * `Number(...)` 로 밀어 넣으면 `"높음"` 이 `NaN` 이 되어 막대가 사라지고,
 * `null` 은 0% 로 그려져 「수용도 0」이라는 없는 사실이 화면에 뜬다.
 */
function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof v !== "object" || v === null) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
    else console.warn("[B-SSE] 숫자가 아닌 수용도 값", k, val);
  }
  return out;
}

/** `{키: 문자열}` 만 걸러 낸다(등급 원문 `LOW`/`MEDIUM`/`HIGH`). 번역하지 않는다. */
function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof v !== "object" || v === null) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
    else console.warn("[B-SSE] 문자열이 아닌 등급 값", k, val);
  }
  return out;
}

export default function DynamicHearingPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const site = useSelectedSite();
  const { selected } = site;
  const reviewed = useArtifact<ReviewedDoc>("reviewed", loadReviewed);
  const inference = reviewed.data?.facility_inference ?? null;

  const ordinanceContexts = useMemo(
    () => collectOrdinanceContexts(reviewed.data),
    [reviewed.data],
  );

  /**
   * 안건은 사람이 쓴다. **기본 문구를 박아 두지 않는다** — 예전 기본값
   * "스마트 흡연부스 설치" 는 도메인 값이라, 성동구 run 을 보면서도 화면이
   * 흡연부스를 안건으로 들고 있었다(원칙 2).
   *
   * 대신 STEP1 이 확정한 시설·지역이 있으면 **그것만** 이어 붙여 초깃값으로
   * 보여준다. `null` = 사람이 아직 안 건드림, 문자열 = 사람이 쓴 값.
   * (effect 로 setState 하지 않는다 — 렌더 중 계산이면 run 이 바뀐 프레임에
   *  직전 run 의 문구가 남지 않는다)
   */
  const [topicInput, setTopicInput] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const suggestedTopic = inference
    ? [inference.region, inference.facility].filter(Boolean).join(" ")
    : "";
  const topic = topicInput ?? suggestedTopic;

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<number>>(new Set());

  /**
   * DEMO: 녹화한 다인 토론의 입력(목적·고른 페르소나). 재생은 요청 본문이 녹화와
   * 같아야 되므로(`demo.ts`) 같은 값을 미리 채우고 같은 사람만 골라 둔다.
   * 사람이 바꿀 수는 있다 — 그러면 「기록에 없는 동작」으로 막힌다.
   */
  const demoInputs = useRef<{ purpose: string; personaNames: string[] } | null>(null);
  useEffect(() => {
    if (!DEMO) return;
    void demoDiscussInputs().then((v) => {
      demoInputs.current = v;
      if (v) setPurpose((p) => p || v.purpose);
    });
  }, []);

  /** 새로 받은 페르소나의 기본 선택. 평소엔 전원, DEMO 면 녹화에서 고른 사람만. */
  const defaultSelection = (list: Persona[], from: number, prev: Set<number>) => {
    const next = new Set(prev);
    const names = demoInputs.current?.personaNames;
    for (let i = from; i < list.length; i++) {
      if (!names || names.includes(list[i]!.display_name)) next.add(i);
    }
    return next;
  };
  const [isLoading, setIsLoading] = useState(false);
  const [personaFailure, setPersonaFailure] = useState<Failure | null>(null);

  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [discussionStatus, setDiscussionStatus] = useState<DiscussionStatus | null>(null);
  const [streamFailure, setStreamFailure] = useState<Failure | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  /**
   * 화면 6 에 넘길 기록. **`messages` state 를 그대로 쓰지 않는다** —
   * 저장 시점(`startDiscussion` 의 `finally`)의 클로저가 보는 `messages` 는
   * 토론 시작 전 값이라 항상 빈 배열이다. effect 로 옮기면 이번엔 매 렌더
   * 새로 만들어지는 `activePersonas` 때문에 저장이 반복된다.
   * ref 는 둘 다 피한다 — 쌓이는 즉시 반영되고 렌더와 무관하다.
   */
  const transcriptRef = useRef<ChatLine[]>([]);
  /**
   * 🔴 이 ref 가 **누산기 본체**다. `discussionStatus` 상태는 그 사본이고,
   *    화면에 그리라고 두는 것뿐이다.
   *
   *    처음엔 반대로 짰다 — `setDiscussionStatus((prev) => { … statusRef.current = next; … })`
   *    로 **updater 안에서** ref 를 채웠다. 그러면 대입 시점이 우리 것이 아니라
   *    **React 가 그 updater 를 실행하기로 한 시점**이 된다. SSE 이벤트가 몰려
   *    들어오면 `await reader.read()` 가 마이크로태스크로 연달아 풀려 React 가
   *    렌더 슬롯을 못 얻고, `[DONE]` → `finally` → `writeHearingB` 까지 한 번에
   *    지나간다 → **`statusRef.current` 는 아직 `null`.**
   *    실측(2026-08-11): 78줄·6명·3라운드 토론이 화면에는 라운드·수용도·시나리오가
   *    다 떴는데 `sessionStorage["omnisite.hearingB.v1"].status` 만 `null` 이었다.
   *    화면 6 은 그 저장분을 읽으므로 **보고서에서만 지표가 사라진다** — 화면 5 를
   *    보고 있으면 멀쩡해 보여서 안 걸린다(원칙 4).
   *
   *    그래서 ref 를 먼저 갱신하고 `setState` 에는 **완성된 값**을 넘긴다.
   *    상태를 먼저 읽어 계산하지 않으므로 updater 형태가 필요 없다.
   */
  const statusRef = useRef<DiscussionStatus | null>(null);

  /**
   * 뜻을 모르고 지나간 이벤트 수(`raw` + 모르는 `type`). **세어서 기록에 남긴다** —
   * 백엔드가 `raw` 를 만든 이유가 「조용히 사라지지 않게」인데, 프런트가 콘솔에만
   * 찍으면 화면·보고서에서는 여전히 사라진다(원칙 4). 콘솔은 탭을 닫으면 없다.
   */
  const unknownEventRef = useRef(0);

  /**
   * 서버가 `hearing_results_b` 에 남겼는지. `saved` / `save_failed` 이벤트로 온다
   * (2026-08-11 백엔드 신설). `statusRef` 와 같은 이유로 **ref 가 본체**다 —
   * 이 두 이벤트는 `[DONE]` 바로 앞에 오므로, 상태에만 담으면 `finally` 가
   * 렌더보다 먼저 돌아 **저장 결과가 빠진 채로** 기록된다.
   */
  const saveRef = useRef<{ id: number | null; url: string | null; error: string | null }>({
    id: null,
    url: null,
    error: null,
  });

  /**
   * 지금 화면이 무엇으로 페르소나를 뽑았는지. 캐시 재사용 여부가 이것으로 갈린다.
   *
   * `useMemo` 인 이유는 성능이 아니다 — 이 객체를 `useCallback` 두 곳이 의존한다.
   * 매 렌더 새 객체면 그 콜백들도 매번 새로 만들어지고, 그중 하나라도
   * effect 의 의존성에 들어가면 **effect 가 렌더마다 다시 돈다**(= 발굴 재호출).
   */
  const scope: PersonaScope | null = useMemo(
    () =>
      site.domain && selected
        ? {
            domain: site.domain,
            runId: site.loadedRunId,
            pnu: selected.pnu,
            topic,
            purpose,
          }
        : null,
    [site.domain, site.loadedRunId, selected, topic, purpose],
  );

  /**
   * LLM 에 넘길 위치 정보. **화면 4 에서 고른 후보 행 그대로**다.
   * `region` 은 STEP1 이 확정한 값이고, 없으면 `null` 로 보낸다 — 없는 지역을
   * 지어내면 페르소나가 다른 동네 사람이 된다.
   */
  const gisData = useMemo(() => {
    if (!selected) return null;
    return {
      domain: site.domain,
      run_id: selected.run_id,
      parcel_id: selected.parcel_id,
      rank: selected.rank,
      pnu: selected.pnu,
      jibun: selected.jibun,
      lat: selected.lat,
      lng: selected.lng,
      facility_type: selected.facility_type,
      region: inference?.region ?? null,
    };
  }, [selected, site.domain, inference]);

  const canSetup = Boolean(selected && gisData && scope && topic.trim() && purpose.trim());

  // ── 페르소나 발굴 ─────────────────────────────────────────
  const appendPersonas = useCallback(
    async (currentScope: PersonaScope, parcelId: number, base: Persona[]) => {
      setIsLoading(true);
      setPersonaFailure(null);
      try {
        /**
         * 🔴 **본문이 좁아졌다**(2026-08-11 백엔드 계약 변경). `gis_data` ·
         *    `ordinance_data` 를 지웠다 — 프런트가 조립해 보내던 위치·조례 문맥을
         *    이제 서버가 `parcel_id` 로 직접 조회한다(`booth_candidates` →
         *    `audit_rules`, 실패 시 Redis 중간 산출물). 프런트가 만들어 보내면
         *    **화면에 뜬 것과 서버가 본 것이 갈릴 수 있다** — 같은 run 을 보는지
         *    프런트는 보증하지 못한다.
         *    제거된 키를 보내면 서버가 **400 + 사유**다(무시가 아니다). 그래서
         *    「보내도 그만」으로 남겨두지 않고 없앤다.
         *
         * 🔴 `topic`·`purpose` 는 남는다 — 이 둘은 조회할 수 있는 값이 아니라
         *    **사람이 이 화면에서 쓴 입력**이다. 서버엔 출처가 없다.
         *
         * ⚠ `ordinanceContexts` 는 지우지 않았다. 요청에서만 빠졌고 화면
         *    (`SetupStep` 의 조례 문맥 건수)에는 그대로 쓴다.
         */
        const res = await postJson<StakeholderCandidate[]>(GENERATE_URL, {
          parcel_id: parcelId,
          topic: currentScope.topic,
          purpose: currentScope.purpose,
        });
        /**
         * 🔴 **개명하지 않는다**(2026-08-11 백엔드 회신). 예전엔 여기서
         *    `display_name→name` · `stakeholder_type→role` ·
         *    `relationship_to_topic→description` 으로 바꿔 담았다. 그 사설 어휘가
         *    `/discuss` 로 되돌아가 페르소나가 전부 `"페르소나 0"` 이 된 사고의
         *    원인이었다. 정본은 응답의 이름 그대로다(`personaCache.ts` 주석).
         *
         * 그래도 통째로 넘기지 않고 **여섯 개만 고른다** — 응답의 나머지
         * (`evidence_confidence` 등)는 쓰는 곳이 없다. 들고 다니면 쓰이는 줄 안다.
         */
        const mapped: Persona[] = res.map((p) => ({
          display_name: p.display_name,
          stakeholder_type: p.stakeholder_type,
          relationship_to_topic: p.relationship_to_topic,
          importance_grade: p.importance_grade,
          keywords: p.keywords ?? [],
          recommendation_reason: p.recommendation_reason,
        }));
        const updated = [...base, ...mapped];
        setPersonas(updated);
        setSelectedPersonaIds((prev) => defaultSelection(updated, base.length, prev));
        writePersonas(currentScope, updated);
      } catch (e) {
        // 🔴 `alert("페르소나 생성 실패")` 로 뭉개지 않는다. 백엔드는 실패 사유를
        //    `detail` 에 실어 준다(`stakeholders.py:38-41`) — 그걸 그대로 띄운다.
        if (e instanceof ApiError) {
          setPersonaFailure({ code: `HTTP ${e.status}`, detail: e.detail });
        } else if (e instanceof NetworkError) {
          setPersonaFailure({ code: "NETWORK", detail: e.message });
        } else {
          setPersonaFailure({ code: "UNKNOWN", detail: String(e) });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const generatePersonas = useCallback(() => {
    if (!scope || !gisData) return;
    setStep(2);

    const cached = readPersonas(scope);
    if (cached) {
      setPersonas(cached);
      setSelectedPersonaIds(defaultSelection(cached, 0, new Set()));
      setPersonaFailure(null);
      return;
    }

    setPersonas([]);
    setSelectedPersonaIds(new Set());
    void appendPersonas(scope, gisData.parcel_id, []);
  }, [scope, gisData, appendPersonas]);

  const fetchMorePersonas = useCallback(() => {
    if (!scope || !gisData) return;
    void appendPersonas(scope, gisData.parcel_id, personas);
  }, [scope, gisData, personas, appendPersonas]);

  const togglePersona = (idx: number) => {
    setSelectedPersonaIds((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const activePersonas = personas.filter((_, idx) => selectedPersonaIds.has(idx));

  // ── 토론 스트리밍 ─────────────────────────────────────────
  /**
   * 프런트가 끼워 넣는 안내(연결 실패·타임아웃 등). `kind: "frontend"` 는
   * **백엔드 어휘가 아니다** — 서버가 준 발화와 프런트가 쓴 문장을 화면 6 에서
   * 가를 수 있어야 해서 따로 둔다(서버 kind 는 persona·moderator·factchecker·unknown).
   */
  const pushSystem = useCallback((text: string) => {
    const line: ChatLine = { speaker: "SYSTEM", text, kind: "frontend" };
    transcriptRef.current.push(line);
    setMessages((prev) => [...prev, line]);
  }, []);

  /**
   * 평평한 이벤트 한 건을 화면 상태로 옮긴다(2026-08-11 계약).
   *
   * 🔴 **문자열 파싱이 없다.** 발화자는 `speaker` 를 그대로 쓴다 — 예전처럼
   *    `"): "` 로 자르면 표시 이름에 괄호·콜론이 든 순간 이름이 조용히 틀린다.
   * 🔴 **모르는 이벤트를 버리지 않는다.** `raw` 는 백엔드가 「뜻은 모르지만
   *    사라지게 두진 않겠다」고 만든 통로다. 여기서 `continue` 로 흘리면 그
   *    통로가 프런트에서 막힌다 — 세어서 기록에 남긴다.
   */
  const applyEvent = useCallback((ev: StreamEvent) => {
    const type = typeof ev.type === "string" ? ev.type : "";

    if (type === "message") {
      const sp = ev.speaker;
      /**
       * 이름이 없으면 지어내지 않는다. `id` → `node` 순으로 **서버가 준 것만**
       * 쓰고 셋 다 없으면 그렇게 적는다 — 「사회자」 같은 걸 채워 넣으면
       * 누가 말했는지 모르는 발화가 누군가의 발화가 된다.
       */
      const speaker =
        (typeof sp?.name === "string" && sp.name.trim()) ||
        (typeof sp?.id === "string" && sp.id.trim()) ||
        (typeof ev.node === "string" && ev.node.trim()) ||
        "(발화자 미상)";
      const kind = typeof sp?.kind === "string" ? sp.kind : "unknown";
      const text = typeof ev.text === "string" ? ev.text : "";
      if (!text.trim()) {
        // 빈 말풍선을 만들지 않는다. 다만 왜 비었는지는 남긴다.
        console.warn("[B-SSE] text 가 빈 message 이벤트", ev);
        return;
      }
      const line: ChatLine = { speaker, text, kind };
      transcriptRef.current.push(line);
      setMessages((prev) => [...prev, line]);
      return;
    }

    if (type === "evaluation") {
      const round = typeof ev.round === "number" ? ev.round : null;
      const acceptance = numberMap(ev.acceptance);
      const cssLevels = stringMap(ev.css_levels);
      /**
       * 라운드마다 통째로 갈아끼우지 않고 **덮어쓴다** — 어떤 라운드에
       * 일부 페르소나만 평가되면, 통째로 바꿀 경우 앞 라운드 값이 사라져
       * 화면에서 그 사람만 없어진 것처럼 보인다.
       */
      const prev = statusRef.current ?? EMPTY_STATUS;
      const next: DiscussionStatus = {
        ...prev,
        round,
        acceptance: { ...prev.acceptance, ...acceptance },
        css_levels: { ...prev.css_levels, ...cssLevels },
      };
      statusRef.current = next;
      setDiscussionStatus(next);
      return;
    }

    if (type === "report") {
      const report =
        typeof ev.final_scenarios === "object" && ev.final_scenarios !== null
          ? (ev.final_scenarios as Record<string, unknown>)
          : null;
      const next: DiscussionStatus = {
        ...(statusRef.current ?? EMPTY_STATUS),
        report,
        is_finished: ev.is_finished === true,
      };
      statusRef.current = next;
      setDiscussionStatus(next);
      return;
    }

    /**
     * 🔴 서버 저장 결과. **성공과 실패를 둘 다 받는다** — 실패만 안 받으면
     *    화면 6 이 「조회하면 있다」고 말하게 된다(원칙 4). 실패는 말풍선으로도
     *    띄운다: 토론은 78줄이 멀쩡히 남았는데 서버엔 없다는 걸 사람이 지금
     *    알아야 다시 돌릴지 정할 수 있다.
     *    `result_url` 은 **서버가 준 문자열을 그대로** 쓴다 — 프런트가 조립하면
     *    경로 규칙이 두 곳에 생긴다.
     */
    if (type === "saved") {
      saveRef.current = {
        id: typeof ev.hearing_id === "number" ? ev.hearing_id : null,
        url: typeof ev.result_url === "string" ? ev.result_url : null,
        error: null,
      };
      return;
    }
    if (type === "save_failed") {
      const reason = typeof ev.error === "string" ? ev.error : "(서버가 사유를 안 줬습니다)";
      saveRef.current = { id: null, url: null, error: reason };
      const line: ChatLine = {
        speaker: "시스템",
        kind: "frontend",
        text: `토론은 끝났지만 서버 저장에 실패했습니다 — ${reason}\n이 탭을 닫으면 기록이 사라집니다.`,
      };
      transcriptRef.current.push(line);
      setMessages((prev) => [...prev, line]);
      return;
    }

    // `error` 는 여기 오기 전에 걸러진다(호출부에서 `error` 키를 먼저 본다).
    unknownEventRef.current += 1;
    console.warn(`[B-SSE] 처리하지 않은 이벤트 (type=${type || "(없음)"})`, ev);
  }, []);

  const startDiscussion = useCallback(async () => {
    if (!gisData) return;
    setStep(3);
    setIsDiscussing(true);
    setMessages([]);
    setDiscussionStatus(null);
    setStreamFailure(null);
    transcriptRef.current = [];
    statusRef.current = null;
    unknownEventRef.current = 0;
    // 🔴 안 비우면 **앞 토론의 저장 결과**가 다음 기록에 그대로 붙는다 —
    //    이번엔 저장에 실패했는데 지난번 `hearing_id` 를 달고 「저장됨」이 된다.
    saveRef.current = { id: null, url: null, error: null };

    /**
     * 🔴 타임아웃을 **갈라 잡는다** — 첫 패킷까지와 그 뒤 침묵은 다른 사건이다.
     *    상수는 화면 5-A 와 공유한다(`simulation.ts`). 그 값은 A 엔진에서 잰
     *    것이고(첫 토론 264.2초 = 벡터 저장소 초기화) **B 엔진의 실측이 아니다** —
     *    여기서는 「이만큼 넘으면 멈춘 것으로 본다」는 상한으로만 쓴다.
     *    상한이 아예 없으면 서버가 조용히 끊겼을 때 화면이 영원히 「준비 중」이다.
     */
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const arm = (ms: number, why: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        setStreamFailure({ code: "TIMEOUT", detail: why });
        controller.abort();
      }, ms);
    };
    arm(FIRST_PACKET_TIMEOUT_MS, `첫 응답이 ${FIRST_PACKET_TIMEOUT_MS / 1000}초 안에 오지 않았습니다.`);

    try {
      const response = await fetch(DISCUSS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /**
         * 🔴 여기도 좁혔다(2026-08-11) — `gis_data` · `ordinance_contexts` 제거.
         *    서버가 `parcel_id` 로 같은 것을 조회한다. 보내면 **400** 이다.
         *    남는 셋은 조회로 대체할 수 없는 것들이다:
         *      `topic`·`purpose` = 사람이 쓴 안건·목적
         *      `personas`        = 사람이 고른 참여자(발굴 결과 중 체크한 것만)
         */
        body: JSON.stringify({
          parcel_id: gisData.parcel_id,
          topic,
          purpose,
          personas: activePersonas,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} — ${detail.slice(0, 300) || response.statusText}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("응답 본문을 읽을 수 없습니다(ReadableStream 없음).");

      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let sawDone = false;

      while (!sawDone) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) {
          /**
           * `[DONE]` 없이 끝났다. **정상 종료로 치지 않는다** — 서버가 도중에
           * 끊긴 것과 다 보낸 것을 같게 취급하면, 잘린 토론이 완결로 보인다.
           */
          if (buffer.trim()) {
            setStreamFailure({
              code: "SSE_TRUNCATED",
              detail: `스트림이 줄 중간에 끊겼습니다. 마지막 조각: ${buffer.slice(0, 300)}`,
            });
          } else {
            setStreamFailure({
              code: "SSE_NO_DONE",
              detail: "서버가 [DONE] 없이 연결을 닫았습니다. 토론이 끝까지 진행되지 않았을 수 있습니다.",
            });
          }
          break;
        }

        arm(IDLE_TIMEOUT_MS, `${IDLE_TIMEOUT_MS / 1000}초 동안 아무 응답이 없었습니다.`);
        buffer += decoder.decode(value, { stream: true });

        /**
         * 🔴 **미완성 조각과 깨진 페이로드를 가른다.**
         *
         * 줄 단위로 자르고 **마지막 조각은 버퍼로 되돌린다** — 그건 아직 `\n`
         * 이 안 온 줄이라 "미완성"이다. 그러고 나면 여기 남은 줄은 전부 `\n`
         * 으로 끝난 **완성된 줄**이고, 그 줄의 JSON 파싱이 실패했다면 그건
         * 조각이 덜 온 게 아니라 **페이로드가 깨진 것**이다.
         * (서버는 `json.dumps` 로 만든 한 줄을 보낸다 — 문자열 안의 개행은
         *  이스케이프되므로 정상 페이로드가 줄을 넘어가는 일은 없다)
         *
         * 예전 코드는 둘 다 `catch {}` 로 삼켰다. 그래서 백엔드가 예외로 뱉는
         * `{"error": ...}` 도(형태가 달라 아무 노드에도 안 걸린다) 화면에는
         * **빈 채팅**으로만 보였다(원칙 1·4).
         */
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "") continue; // SSE 프레임 구분자
          if (trimmed.startsWith(":")) continue; // SSE 주석(keep-alive)
          if (!trimmed.startsWith("data:")) {
            // `event:`·`id:` 등 우리가 안 쓰는 필드. 조용히 버리지 않고 남긴다.
            console.warn("[SSE] data 가 아닌 필드", trimmed);
            continue;
          }

          const payload = trimmed.slice("data:".length).trim();
          if (payload === "[DONE]") {
            sawDone = true;
            break;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch (e) {
            setStreamFailure({
              code: "SSE_MALFORMED",
              detail: `완성된 줄인데 JSON 이 아닙니다: ${payload.slice(0, 300)}`,
            });
            console.error("[SSE] 페이로드 파싱 실패", e, payload);
            continue;
          }

          if (typeof parsed !== "object" || parsed === null) {
            setStreamFailure({
              code: "SSE_UNEXPECTED",
              detail: `객체가 아닌 페이로드: ${payload.slice(0, 300)}`,
            });
            continue;
          }

          /**
           * 백엔드가 예외를 이 모양으로 흘린다. 2026-08-11 계약에서 `type:"error"`
           * 가 덧붙었지만 **`error` 키는 그대로 뒀다** — 그래서 여기 검사가
           * 그대로 유효하다. `type` 으로 갈아타지 않는 이유: 옛 서버(지금 돌고
           * 있는 프로세스)는 `type` 을 안 붙인다.
           */
          const maybeError = (parsed as { error?: unknown }).error;
          if (typeof maybeError === "string") {
            setStreamFailure({ code: "SERVER_ERROR", detail: maybeError });
            pushSystem(`백엔드 토론 엔진 오류: ${maybeError}`);
            sawDone = true;
            break;
          }

          applyEvent(parsed as StreamEvent);
        }
      }
    } catch (e) {
      if (timedOut) {
        pushSystem("응답이 없어 연결을 끊었습니다. 위 사유를 확인하세요.");
      } else {
        const detail = e instanceof Error ? e.message : String(e);
        setStreamFailure({ code: "STREAM_FAILED", detail });
        pushSystem(`백엔드 실시간 토론 연결 실패: ${detail}`);
      }
    } finally {
      if (timer) clearTimeout(timer);
      setIsDiscussing(false);

      /**
       * 🔴 못 알아들은 이벤트가 있었으면 **기록에 적는다.** 콘솔에만 찍으면
       *    탭을 닫는 순간 없어지고, 화면 6 보고서는 그 토론을 온전한 것으로
       *    싣는다. 몇 건인지만 적는다 — 내용을 지어내지 않는다(원칙 4).
       */
      if (unknownEventRef.current > 0) {
        pushSystem(
          `백엔드가 보낸 이벤트 ${unknownEventRef.current}건을 이 화면이 해석하지 못했습니다` +
            ` (브라우저 콘솔의 [B-SSE] 로그 참고). 토론 내용 일부가 화면에 안 보일 수 있습니다.`,
        );
      }

      /**
       * 화면 6 이 읽을 자리에 남긴다. **중간에 끊겨도 남긴다** —
       * 실패 사유는 `pushSystem` 이 기록에 넣어 두었고, 「토론이 없다」와
       * 「토론이 끊겼다」는 보고서에서 다른 사실이다(원칙 4).
       * 한 줄도 못 받았으면 안 쓴다 — 빈 기록은 실을 게 없다.
       */
      if (transcriptRef.current.length > 0) {
        writeHearingB({
          lines: transcriptRef.current,
          scope: {
            domain: site.domain,
            runId: site.loadedRunId,
            pnu: gisData.pnu,
            jibun: gisData.jibun,
            parcelId: gisData.parcel_id,
            topic,
            purpose,
          },
          participants: activePersonas.map((p) => `[${p.stakeholder_type}] ${p.display_name}`),
          status: statusRef.current,
          serverId: saveRef.current.id,
          resultUrl: saveRef.current.url,
          saveError: saveRef.current.error,
        });
      }
    }
  }, [
    activePersonas,
    topic,
    purpose,
    gisData,
    site.domain,
    site.loadedRunId,
    applyEvent,
    pushSystem,
  ]);

  return (
    <PageBody>
      <PageHeader
        screen={SCREEN}
        lead="이해관계자를 생성해 다자간 토론을 진행합니다."
      />


      {/* 어느 점으로 토론하는지 먼저 밝힌다. 못 이었으면 여기서 멈춘다. */}
      <div className="mt-4">
        <SitePanel site={site} />
      </div>

      <OrdinanceNote
        loading={reviewed.loading}
        unavailable={reviewed.unavailable}
        error={reviewed.error}
        count={ordinanceContexts.length}
      />

      {personaFailure && (
        <FailureBox title="페르소나를 발굴하지 못했습니다" failure={personaFailure} />
      )}
      {streamFailure && <FailureBox title="토론 스트림에 문제가 있습니다" failure={streamFailure} />}
      <div className="mb-8 mt-4 relative flex items-center justify-center">
        <div className="flex">
          {[
            { num: 1, title: "안건 확정" },
            { num: 2, title: "이해관계자 선택" },
            { num: 3, title: "토론진행" },
          ].map((s) => (
            <div key={s.num} className="flex items-center">
              <div
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] transition-colors ${
                  step === s.num
                    ? "bg-blue-50 border border-blue-100 text-blue-900 font-bold"
                    : step > s.num
                    ? "text-gray-700 border border-transparent"
                    : "text-gray-500 border border-transparent"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  step === s.num ? 'bg-blue-500 animate-pulse' : 
                  step > s.num ? 'bg-green-500' : 'bg-gray-300'
                }`} />
                <span className="hidden sm:inline">
                  {s.title}
                </span>
              </div>
              {s.num < 3 && (
                <div
                  className={`mx-1 h-[1px] w-4 transition-all duration-300 md:w-8 ${
                    step > s.num ? "bg-green-500" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

      </div>

      {/**
        * 🔴 **3단계도 「남은 자리를 채우는」 칸이다**(2026-08-15). 예전엔 1단계만
        *    `flex-1` 이고 2·3단계는 `min-h-[600px]` 로 **내용만큼 자라는** 칸이었다.
        *    3단계 토론판은 자기 높이를 `calc(100vh-200px)` 로 잡고 있어서(그건
        *    `DiscussionStep` 쪽에서 고쳤다) 이 칸이 775px 로 부풀었고, 그 초과분이
        *    `PageBody` 로 넘어가 **페이지 스크롤바**가 생겼다(실측 876 → 945).
        *
        * ⚠ `overflow-x-hidden` 하나만 준 것도 함정이었다. CSS 는 한 축이
        *   `visible` 이고 다른 축이 아니면 **`visible` 쪽을 `auto` 로 바꾼다** —
        *   가로만 자르려 했는데 세로 스크롤 컨테이너가 딸려 생겼다(실측
        *   clientHeight 600 · scrollHeight 775 로 **두 번째 스크롤바**). 그래서
        *   3단계는 `overflow-hidden` 으로 두 축을 함께 못박는다.
        *
        * 2단계(페르소나 카드 그리드)는 그대로 둔다 — 인원수만큼 자라는 게 맞고,
        * 자란 만큼 `PageBody` 가 스크롤하는 것도 그 화면에서는 정상이다.
        */}
      <div className={`relative ${step === 2 ? 'min-h-[600px] overflow-x-hidden' : 'flex-1 flex flex-col min-h-0 overflow-hidden'}`}>
        <SetupStep
          step={step}
          topic={topic}
          setTopic={setTopicInput}
          purpose={purpose}
          setPurpose={setPurpose}
          isLoading={isLoading}
          canStart={canSetup}
          blockedReason={setupBlockedReason(site, topic, purpose)}
          generatePersonas={generatePersonas}
        />

        <PersonaStep
          step={step}
          personas={personas}
          selectedPersonaIds={selectedPersonaIds}
          togglePersona={togglePersona}
          fetchMorePersonas={fetchMorePersonas}
          isLoading={isLoading}
          startDiscussion={() => void startDiscussion()}
          setStep={setStep}
        />

        <DiscussionStep
          step={step}
          messages={messages}
          isDiscussing={isDiscussing}
          discussionStatus={discussionStatus}
          chatContainerRef={chatContainerRef}
          setStep={setStep}
          activePersonas={activePersonas}
          topic={topic}
        />
      </div>

      {/* 바닥 내비게이션 바. `mb-8` 을 뺐다 — `PageBody` 가 이미 `pb-10` 이라
          바닥 여백이 두 겹이었고, 그 32px 은 3단계에서 채팅창 높이를 그만큼
          깎고 있었다(실측 채팅창 296px). */}
      <div className="mt-6 flex shrink-0 items-center justify-between rounded-2xl border border-gray-100 bg-white px-8 py-5 shadow-sm">
        <Link
          href="/sites"
          className="rounded-xl border border-gray-200 bg-white px-6 py-2.5 text-sm font-bold text-gray-500 transition-colors hover:bg-gray-50"
        >
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            이전 단계
          </div>
        </Link>
        {discussionStatus?.is_finished ? (
          <Link
            href="/report"
            className="rounded-xl bg-green-600 px-8 py-2.5 text-sm font-bold text-white shadow-md shadow-green-200 transition-colors hover:bg-green-700"
          >
            <div className="flex items-center gap-2">
              갈등 예측 완료, 보고서로 넘어가기 &gt;
            </div>
          </Link>
        ) : (
          <button
            disabled
            className="rounded-xl bg-gray-300 px-8 py-2.5 text-sm font-bold text-white cursor-not-allowed opacity-70"
          >
            <div className="flex items-center gap-2">
              갈등 예측 진행 중...
            </div>
          </button>
        )}
      </div>
    </PageBody>
  );
}

/** 1단계 버튼을 막는 사유. **하나로 뭉치지 않는다** — 사람이 할 일이 서로 다르다. */
function setupBlockedReason(
  site: ReturnType<typeof useSelectedSite>,
  topic: string,
  purpose: string,
): string | null {
  if (!site.domain) return "실행 중인 run 이 없어 도메인을 알 수 없습니다. 화면 1 에서 먼저 시작하세요.";
  if (site.loading) return "후보점을 불러오는 중입니다.";
  if (site.failure) return "후보점을 불러오지 못했습니다. 위 사유를 확인하세요.";
  if (site.pick === undefined) return "화면 4 의 선택을 읽는 중입니다.";
  if (site.pickMissing) return "화면 4(위치 선정)에서 공청회를 열 위치를 먼저 고르세요.";
  if (site.pickUnmatched) return "고른 위치를 적재된 후보 목록에서 찾지 못했습니다.";
  if (!site.selected) return "토론할 위치가 정해지지 않았습니다.";
  if (!topic.trim()) return "공청회 핵심 주제를 입력하세요.";
  if (!purpose.trim()) return "설치 목적 및 기대 효과를 입력하세요.";
  return null;
}

/**
 * 선정 위치 패널.
 *
 * 화면 5-A 의 `CandidatePanel` 과 **같은 판단**을 한다(안 골랐다 · 골랐는데 목록에
 * 없다 · 이었다). 판단 자체는 `useSelectedSite()` 한 곳에 있고 여기는 그 결과를
 * 이 화면의 폭에 맞게 그리기만 한다.
 */
function SitePanel({ site }: { site: ReturnType<typeof useSelectedSite> }) {
  const { domain, loading, failure, candidates, selected, pick, pickMissing, pickUnmatched } = site;

  if (!domain) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-[13px] text-gray-700">
        실행 중인 run 이 없어 <b>도메인</b>을 알 수 없습니다. 화면 1 에서 분석을 먼저 시작하세요.
        <span className="ml-1 text-gray-500">
          (도메인 기본값을 두지 않습니다 — 다른 지자체 후보로 토론하게 됩니다)
        </span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 text-[13px] text-gray-600">
        STEP4 Top-N 후보를 불러오는 중… (domain={domain})
      </div>
    );
  }

  if (failure) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-red-800">후보점을 불러오지 못했습니다</span>
          <span className="rounded-md bg-red-100 px-2 py-0.5 font-mono text-[11px] text-red-700">
            {failure.code}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-all font-mono text-[12px] text-red-900">
          {failure.detail}
        </p>
        <button
          onClick={site.reload}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 hover:bg-red-50"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (pickMissing) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] text-amber-900">
        <p className="font-semibold">공청회를 열 위치가 아직 정해지지 않았습니다.</p>
        <p className="mt-1">
          화면 4(위치 선정)에서 한 곳을 고르고 「이 위치로 갈등 예측 실행」을 누르세요.
          <span className="ml-1 text-amber-800/80">
            (1순위를 자동으로 집지 않습니다 — 순위는 추천이지 결정이 아닙니다)
          </span>
        </p>
        <Link
          href="/sites"
          className="mt-3 inline-block rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-bold text-amber-800 hover:bg-amber-50"
        >
          화면 4 로 이동
        </Link>
      </div>
    );
  }

  if (pickUnmatched && pick) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-[13px] text-red-900">
        <p className="font-semibold">고른 위치를 적재된 후보 목록에서 찾지 못했습니다.</p>
        <p className="mt-1">
          화면 4 에서 고른 것: <b>{pick.jibun}</b> ({pick.rank}순위 ·{" "}
          <span className="font-mono">PNU {pick.pnu}</span>
          {pick.run_id ? ` · run ${pick.run_id}` : ""})
        </p>
        <p className="mt-1">
          지금 적재된 후보는 {candidates?.length ?? 0}건인데 그 안에 이 PNU 가 없습니다.
          <b> 순위가 같은 다른 필지로 대신 돌리지 않습니다.</b>
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={site.reload}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 hover:bg-red-50"
          >
            후보 목록 다시 불러오기
          </button>
          <Link
            href="/sites"
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[12px] font-bold text-red-700 hover:bg-red-50"
          >
            화면 4 에서 다시 고르기
          </Link>
        </div>
      </div>
    );
  }

  return null;
}

/**
 * 조례 근거를 **못 읽었을 때만** 말한다. 잘 읽혔으면 아무것도 띄우지 않는다.
 *
 * 🔴 **「N 건 있습니다」는 지웠다**(2026-08-15 사용자 지시). 예전엔 건수를 늘 띄웠는데,
 *    이 화면을 쓰는 사람이 할 수 있는 일이 없는 문장이었다 — 요청에 싣지도 않고
 *    (2026-08-11 계약 변경으로 서버가 `parcel_id` 로 직접 조회한다), 건수를 봐도
 *    누를 것도 고칠 것도 없다. 정상일 때 침묵하는 게 맞다.
 *
 * ⚠ **0 건과 읽기 실패는 계속 띄운다.** 그건 성질이 다르다 — 이 화면이 보여줄 근거가
 *   없다는 뜻이고, 사용자가 「왜 근거가 안 보이지」를 물을 자리다. 조용히 넘기면
 *   그게 조용한 실패다(원칙 1). 다만 서버가 조회할 근거까지 없다는 뜻은 아니다.
 */
function OrdinanceNote({
  loading,
  unavailable,
  error,
  count,
}: {
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  count: number;
}) {
  if (loading) return null;

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-900">
        STEP1 감리 산출물(`reviewed`)을 읽지 못했습니다 — 이 화면에 조례 근거를 보여줄 수
        없습니다. 토론 자체는 서버가 parcel_id 로 조회한 근거로 진행됩니다.
        <span className="ml-1 font-mono">{error}</span>
      </div>
    );
  }

  if (unavailable || count === 0) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
        <b>조례 근거 0건.</b>{" "}
        {unavailable
          ? "이 run 에 STEP1 감리 산출물이 없습니다."
          : "감리 산출물에 근거문장이 하나도 없습니다."}{" "}
        예시 조문을 대신 지어내지 않습니다. 이건 <b>이 화면이 보여줄 근거가 없다</b>는
        뜻이고, 서버가 조회할 근거까지 없다는 뜻은 아닙니다.
      </div>
    );
  }

  // 근거가 있다 = 정상. 할 말이 없다.
  return null;
}

function FailureBox({ title, failure }: { title: string; failure: Failure }) {
  return (
    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-bold text-red-800">{title}</span>
        <span className="rounded-md bg-red-100 px-2 py-0.5 font-mono text-[11px] text-red-700">
          {failure.code}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-all font-mono text-[12px] text-red-900">
        {failure.detail}
      </p>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="text-ink-secondary">{k} </span>
      <span className="font-mono text-ink">{v}</span>
    </div>
  );
}
