/**
 * DEMO 모드 — 실제 실행 기록 재생.
 * ================================
 * 백엔드 없이 뜨는 포트폴리오 데모가 `demo-recording/<run_id>/` 에 녹화한
 * **실제 요청·응답**을 그대로 돌려준다(`scripts/record_proxy.py` 가 만든 것).
 *
 * 🔴 **값을 지어내지 않는다.** 녹화에 없는 요청, 녹화와 다른 입력의 POST 에는
 *    가짜 응답을 만들지 않고 「기록에 없는 동작」이라고 답한다(`unrecorded`).
 *    화면은 그 사유를 서버 오류처럼 그대로 띄운다 — 어디서 막혔는지가 보인다.
 *
 * 🔴 **가로채는 자리는 `window.fetch` 하나다**(`src/instrumentation-client.ts`).
 *    백엔드로 나가는 길이 셋(`client.ts` 의 `request()` · `directUrl()` 절대주소 ·
 *    화면 5 의 날 `fetch`/`fetchEventSource`)인데, 셋 다 결국 `window.fetch` 를
 *    부른다. 길마다 어댑터를 끼우면 새 호출이 생길 때 하나가 빠진다.
 *
 * ── 같은 요청이 여러 번 녹화된 경우 ──────────────────────────────
 * 상태 폴링(46건)·공청회 목록(12건)처럼 같은 GET 이 시점마다 다른 답을 받았다.
 * 고르는 기준은 **마지막으로 재생한 POST(기준점)** 다:
 *   ① 기준점과 다음 POST 사이에 녹화된 것 중, 기준점 이후 녹화 경과가
 *      재생 경과 이하인 마지막 것 → 실행 진행이 녹화 속도대로 흐른다
 *   ② 그 구간에 없으면 기준점 이전의 마지막 것 → 지금 상태와 같은 답
 *   ③ 그것도 없으면 가장 가까운 뒤의 것
 * 호출 횟수로 세지 않는 이유 — 새로고침·화면 재방문으로 호출 수는 녹화와 달라진다.
 * 기준점은 localStorage 에 둔다(`omnisite.runId.v1` 과 수명이 같아야 새로고침 뒤에도
 * 진행이 이어진다).
 */

export const DEMO_RUN = process.env.NEXT_PUBLIC_DEMO_RUN ?? "";
export const DEMO = DEMO_RUN !== "";

const BASE = `/demo/${DEMO_RUN}`;
const STATE_KEY = "omnisite.demo.v1";

export interface DemoEntry {
  index: number;
  method: string;
  path: string;
  status: number;
  content_type: string | null;
  body_file: string | null;
  is_sse: boolean;
  screen: string;
  t_start_ms: number;
  duration_ms?: number;
  first_packet_ms?: number | null;
  request_file?: string | null;
  content_disposition?: string;
}

export interface DemoManifest {
  run_id: string;
  domain: string;
  mode: string;
  auto_approve: boolean;
  recorded_at: string;
  entries: DemoEntry[];
}

interface Anchor {
  run: string;
  index: number; // 기준점 POST 의 index (0 = 아직 없음)
  t0: number; // 그 POST 의 녹화 t_start_ms
  at: number; // 재생한 벽시계(ms)
}

let manifestP: Promise<DemoManifest> | null = null;
let rawFetch: typeof fetch | null = null;

function baseFetch(): typeof fetch {
  return rawFetch ?? fetch.bind(globalThis);
}

export function loadDemoManifest(): Promise<DemoManifest> {
  if (!manifestP) {
    manifestP = baseFetch()(`${BASE}/manifest.json`, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`DEMO 기록을 못 읽었습니다: ${BASE}/manifest.json → HTTP ${r.status}`);
      return r.json() as Promise<DemoManifest>;
    });
  }
  return manifestP;
}

/** 녹화 파일 하나(요청 본문 등)를 JSON 으로 읽는다. */
export async function loadDemoJson<T>(file: string): Promise<T> {
  const r = await baseFetch()(`${BASE}/${file}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`DEMO 기록 파일을 못 읽었습니다: ${file} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** 녹화에서 그 POST 가 받은 요청 본문. 화면이 같은 입력을 미리 채우는 데 쓴다. */
export async function recordedRequestBody<T>(method: string, pathPrefix: string): Promise<T | null> {
  const m = await loadDemoManifest();
  const e = m.entries.find((x) => x.method === method && x.path.startsWith(pathPrefix) && x.request_file);
  return e?.request_file ? loadDemoJson<T>(e.request_file) : null;
}

/**
 * 화면 5B 에서 녹화와 같은 입력을 미리 채우려고 쓴다 — 목적(사람이 쓴 값)과
 * 토론에 넣은 페르소나 이름. 녹화에 다인 토론이 없으면 `null`.
 */
export async function demoDiscussInputs(): Promise<{ purpose: string; personaNames: string[] } | null> {
  const body = await recordedRequestBody<{ purpose?: string; personas?: { display_name?: string }[] }>(
    "POST",
    "/api/v1/stakeholders/dynamic/discuss/stream",
  );
  if (!body) return null;
  return {
    purpose: body.purpose ?? "",
    personaNames: (body.personas ?? []).map((p) => p.display_name ?? "").filter(Boolean),
  };
}

// ── 기준점 ───────────────────────────────────────────────────

function readAnchor(): Anchor {
  try {
    const a = JSON.parse(window.localStorage.getItem(STATE_KEY) ?? "null") as Anchor | null;
    if (a && a.run === DEMO_RUN) return a;
  } catch {
    /* 깨진 값은 처음부터로 */
  }
  return { run: DEMO_RUN, index: 0, t0: 0, at: Date.now() };
}

function writeAnchor(a: Anchor) {
  window.localStorage.setItem(STATE_KEY, JSON.stringify(a));
}

/** 처음부터 다시 보기. 브라우저 상태만 지운다 — 지울 서버가 없다. */
export function restartDemo(): void {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // 라우터 이동이 아니라 새로 읽는다 — `useArtifact` 캐시·RunProvider 상태 같은
  // 메모리 속 재생 결과까지 같이 비워야 처음부터다.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
}

// ── 요청 대조 ────────────────────────────────────────────────

/** 출처를 떼고 쿼리를 정렬한 키. 녹화의 `path` 와 화면의 URL 을 같은 모양으로 만든다. */
function keyOf(method: string, url: URL): string {
  const q = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = q.map(([k, v]) => `${k}=${v}`).join("&");
  return `${method.toUpperCase()} ${decodeURIComponent(url.pathname)}${qs ? `?${qs}` : ""}`;
}

function entryKey(e: DemoEntry): string {
  return keyOf(e.method, new URL(e.path, "http://x"));
}

function isMilestone(e: DemoEntry): boolean {
  return e.method !== "GET";
}

function pick(cands: DemoEntry[], all: DemoEntry[], a: Anchor): DemoEntry {
  const next = all.find((e) => isMilestone(e) && e.index > a.index)?.index ?? Infinity;
  const win = cands.filter((e) => e.index > a.index && e.index < next);
  if (win.length) {
    const elapsed = Date.now() - a.at;
    const due = win.filter((e) => e.t_start_ms - a.t0 <= elapsed);
    return due.length ? due[due.length - 1]! : win[0]!;
  }
  const before = cands.filter((e) => e.index < a.index);
  if (before.length) return before[before.length - 1]!;
  return cands.find((e) => e.index > a.index) ?? cands[cands.length - 1]!;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameJson(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && sameJson(ao[k], bo[k]));
}

function unrecorded(method: string, path: string, why: string): Response {
  const detail =
    `이 데모는 실제 실행 기록(${DEMO_RUN})을 재생합니다. ${why} ` +
    `상단 띠의 「기록된 경로」를 따라가 주세요. (${method} ${path})`;
  return new Response(JSON.stringify({ detail }), {
    status: 501,
    headers: { "Content-Type": "application/json" },
  });
}

function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, Math.max(0, ms));
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

// ── 응답 만들기 ──────────────────────────────────────────────

interface SseLine {
  t_ms: number;
  event: string | null;
  data: string | null;
  id?: string;
  retry?: string;
  comment?: string;
}

/** 녹화한 이벤트를 SSE 문법으로 되돌린다. 필드 순서는 서버가 쓰는 순서를 따른다. */
function encodeEvent(ev: SseLine): string {
  const out: string[] = [];
  if (ev.comment != null) for (const c of ev.comment.split("\n")) out.push(`: ${c}`);
  if (ev.event != null) out.push(`event: ${ev.event}`);
  if (ev.id != null) out.push(`id: ${ev.id}`);
  if (ev.retry != null) out.push(`retry: ${ev.retry}`);
  if (ev.data != null) for (const d of ev.data.split("\n")) out.push(`data: ${d}`);
  return out.join("\n") + "\n\n";
}

async function sseResponse(e: DemoEntry, signal?: AbortSignal | null): Promise<Response> {
  const text = await (await baseFetch()(`${BASE}/${e.body_file}`, { cache: "no-store" })).text();
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as SseLine);
  const enc = new TextEncoder();
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 첫 패킷까지의 대기도 녹화값 그대로 — 그 뒤는 첫 패킷 기준 t_ms 간격
        await wait(e.first_packet_ms ?? 0, signal);
        const t0 = Date.now();
        for (let i = 0; i < events.length && !cancelled; ) {
          const t = events[i]!.t_ms;
          await wait(t - (Date.now() - t0), signal);
          let chunk = "";
          // 한 네트워크 조각에 실려 온 것(같은 t_ms)은 한 번에 보낸다
          while (i < events.length && events[i]!.t_ms === t) chunk += encodeEvent(events[i++]!);
          controller.enqueue(enc.encode(chunk));
        }
        controller.close();
      } catch (err) {
        if (!cancelled) controller.error(err);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, {
    status: e.status,
    headers: { "Content-Type": e.content_type ?? "text/event-stream" },
  });
}

async function plainResponse(e: DemoEntry, signal?: AbortSignal | null): Promise<Response> {
  const buf = e.body_file
    ? await (await baseFetch()(`${BASE}/${e.body_file}`, { cache: "no-store" })).arrayBuffer()
    : null;
  // 응답이 걸린 시간도 녹화값 그대로(페르소나 발굴 22.7초 등). 폴링은 수 ms 다.
  await wait(e.duration_ms ?? 0, signal);
  const headers = new Headers();
  if (e.content_type) headers.set("Content-Type", e.content_type);
  if (e.content_disposition) headers.set("Content-Disposition", e.content_disposition);
  const nullBody = e.status === 204 || e.status === 304 || !buf;
  return new Response(nullBody ? null : buf, { status: e.status, headers });
}

async function requestBodyJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  let raw: string | null = null;
  if (init?.body != null) {
    raw = typeof init.body === "string" ? init.body : null;
  } else if (input instanceof Request) {
    raw = await input.clone().text();
  }
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function replay(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = input instanceof Request ? input.url : String(input);
  const url = new URL(href, window.location.origin);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
  const shown = `${url.pathname}${url.search}`;

  const m = await loadDemoManifest();
  const key = keyOf(method, url);
  const cands = m.entries.filter((e) => entryKey(e) === key);
  if (!cands.length) return unrecorded(method, shown, "이 요청은 녹화에 없습니다.");

  const a = readAnchor();
  let e: DemoEntry;
  if (method === "GET") {
    e = pick(cands, m.entries, a);
  } else {
    e = cands[0]!;
    if (e.request_file) {
      const [want, got] = await Promise.all([loadDemoJson<unknown>(e.request_file), requestBodyJson(input, init)]);
      if (!sameJson(want, got)) {
        return unrecorded(method, shown, "입력값이 기록된 실행과 달라 재생할 수 없습니다.");
      }
    }
    // 앞선 기준점으로 되돌아가지 않는다 — 이미 재생한 토론이 목록에서 사라진다
    if (e.index > a.index) writeAnchor({ run: DEMO_RUN, index: e.index, t0: e.t_start_ms, at: Date.now() });
  }
  return e.is_sse ? sseResponse(e, signal) : plainResponse(e, signal);
}

/**
 * `window.fetch` 를 감싼다. 경로가 `/api/v1/` 로 시작하면 출처와 상관없이 재생한다 —
 * 운영 빌드의 `directUrl()` 은 절대주소(`BACKEND_ORIGIN`)를 만든다.
 * 나머지(녹화 파일 자체, 지도 타일, Next 내부 요청)는 원래 fetch 로 보낸다.
 */
export function installDemoFetch(): void {
  if (!DEMO || typeof window === "undefined" || rawFetch) return;
  rawFetch = window.fetch.bind(window);
  const original = rawFetch;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let path = "";
    try {
      const href = input instanceof Request ? input.url : String(input);
      path = new URL(href, window.location.origin).pathname;
    } catch {
      /* URL 이 아니면 원래 fetch 가 판단한다 */
    }
    if (path.startsWith("/api/v1/")) return replay(input, init);
    return original(input, init);
  };
}
