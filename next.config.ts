import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

/**
 * 백엔드 API 오리진.
 *
 * 🔴 `NEXT_PUBLIC_` 을 쓰지 않는다 — 이 값은 브라우저 번들에 박히면 안 된다.
 *    브라우저는 항상 같은 출처(`/api/v1/pipeline/...`)로만 부르고, 실제 백엔드
 *    주소는 이 rewrite 안에서만 안다. 백엔드가 다른 호스트로 가도 프런트 코드는
 *    한 글자도 안 바뀐다.
 *
 * 기본값을 둔 이유: 도메인 값(시설명·반경 등)이 아니라 **개발 환경의 기본 포트**다.
 * 하드코딩 금지 원칙이 막는 것은 도메인 상수이지 로컬 개발 기본값이 아니다.
 * 그래도 `.env.local` 로 언제든 덮어쓸 수 있게 열어 둔다.
 */
const API_ORIGIN = process.env.OMNISITE_API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  /**
   * 워크스페이스 루트 고정.
   *
   * 부모 폴더 `D:\B_P\` 에 `package-lock.json` 이 있어서 Turbopack 이 루트를
   * 거기로 추론하고 경고를 냈다. 추론된 루트가 바뀌면 파일 추적 범위와
   * 출력 경로가 조용히 달라진다 — 경고를 끄는 게 아니라 **루트를 못박는다.**
   *
   * 🔴 `import.meta.dirname` 을 먼저 썼다가 `globals.css` 의 `@import "./theme.css"`
   *    가 프로젝트 루트에서 해석되며 resolve 에러가 났다. `package.json` 에
   *    `"type": "module"` 이 없어 이 설정 파일은 **CJS 로 로드**되고, 그때
   *    `import.meta.dirname` 은 `undefined` 다 → `root: undefined`.
   *    설정 오타 하나가 CSS 해석 실패로 나타나서 원인이 안 보였다. CJS 전역인
   *    `__dirname` 을 쓴다. 절대경로를 박지 않으므로 폴더를 옮겨도 따라온다.
   *
   * `process.cwd()` 는 답이 아니다 — `npm --prefix` 로 띄우면 cwd 가 다른 폴더다.
   */
  turbopack: { root: __dirname },

  /**
   * rewrite 프록시가 응답을 포기하는 시각.
   *
   * 🔴 **기본값 30초가 우리 상한을 전부 덮어쓰고 있었다**(2026-08-11 실측).
   *    `node_modules/next/dist/server/lib/router-utils/proxy-request.js:33` 이
   *    `proxyTimeout || 30000` 이다. 이건 프록시→백엔드 소켓의 **무음 상한**이라
   *    LLM 이 생각하는 동안(응답 헤더도 안 옴) 그대로 걸린다.
   *
   *    증상이 고약하다 — 프록시가 끊으면 브라우저에는 **500 "Internal Server
   *    Error"** 가 온다. 백엔드는 멀쩡히 계속 돌아 200 을 만들어내는데 화면은
   *    "페르소나를 발굴하지 못했습니다 / HTTP 500" 을 띄운다. 서버가 실패했다고
   *    **없는 사실을 말하는** 것이다(원칙 4). 실측:
   *      · `POST /stakeholders/generate` 29.2s → 200 · 30.0s → **500** (같은 요청)
   *      · 백엔드에 직접 curl 하면 35.4s 200. 죽인 쪽은 백엔드가 아니다
   *      · Next 로그에는 `Failed to proxy … ECONNRESET (socket hang up)` 만 남는다
   *
   * 🔴 값의 근거는 **`simulation.ts` 의 `FIRST_PACKET_TIMEOUT_MS`(5분)** 다.
   *    거기 적힌 실측이 「첫 SSE 패킷까지 264.2초」(PGVector 초기화가 프로세스당
   *    1회)인데, 프록시가 30초에 끊으면 **그 5분은 한 번도 쓰인 적이 없다.**
   *    타임아웃을 두 군데가 각자 정하면 짧은 쪽이 조용히 이긴다.
   *
   *    그래서 여기 값은 「멈춤을 판정하는 값」이 아니라 **「판정을 프런트에
   *    맡기기 위해 비켜 주는 값」** 이다 — 프런트 상한(5분)보다 크기만 하면 된다.
   *    멈춤 판정은 화면이 한다(`arm(IDLE_TIMEOUT_MS)` · 첫 패킷 5분). 그쪽은
   *    사유를 화면에 적을 수 있지만 프록시는 500 밖에 못 말한다.
   *    ⚠ `FIRST_PACKET_TIMEOUT_MS` 를 올리면 **이 값도 같이 올린다.**
   *    (`import` 로 묶지 않은 이유: 이 파일은 CJS 로 로드된다 — 위 `__dirname` 주석)
   */
  /**
   * 🔴 **업로드 본문 상한.** 기본값은 **10MB** 이고, 넘으면 프록시가 몸통을 잘라
   *    보낸 뒤 소켓을 끊는다. 이것 때문에 화면1 데이터 업로드가 통째로 막혀 있었다.
   *
   *    증상이 「느리다」로 읽힌다 — 실측(2026-08-13):
   *      · 백엔드 직접(`:8000`) 129.7MB → **200 · 0.60초**(215MB/s). 느리지 않다
   *      · Next 프록시(`:3000`) 같은 파일 → **500 · 360.09초**(= 위 proxyTimeout)
   *      · 절벽은 4.6MB(200 · 0.06초) ↔ 19.5MB(**300초 TimeoutError**) 사이
   *    Next 자신의 로그가 원인을 정확히 말한다:
   *      `Request body exceeded 10MB for /api/v1/upload/data. Only the first 10MB
   *       will be available unless configured.` → 이어서 `socket hang up (ECONNRESET)`
   *
   * ⚠ **그 로그가 가리키는 옵션 이름은 이 버전에서 이미 옛것이다.** 문구는
   *    `middlewareClientMaxBodySize` 를 안내하는데 Next 16.3 은 그걸 쓰면
   *    `deprecated` 경고를 내고 `proxyClientMaxBodySize` 로 옮겨 담는다
   *    (`next/dist/server/config.js:185,747`). 둘을 **같이 적으면 기동이 죽는다**
   *    (:718). 에러 문구가 알려준 이름을 그대로 믿지 말고 스키마를 볼 것.
   *
   * 🔴 제일 나쁜 건 **파일은 실제로 저장된다**는 점이다. 몸통은 백엔드까지 가서
   *    디스크에 떨어지는데(테스트 4개 전부 확인) 잃는 건 **응답**이다. 그래서
   *    브라우저는 몇 분 멈췄다가 500 을 받고, 사용자는 「업로드 실패」로 읽는다 —
   *    서버가 없는 사실을 말하는 것이다(원칙 4). 사용자가 본 빈 `그늘막/{data,law}`
   *    도 이것이었다: 폴더는 `_dirs()` 가 먼저 만들고 몸통이 거기서 멎었다.
   *
   *    값의 근거는 **실제 배치 크기**다 — 사용자 화면의 한 번 업로드가 141.6MB +
   *    106.8MB ≒ 248MB 였다. 그 위로 여유를 둔다. ⚠ 이 값을 올린다고 백엔드가
   *    느려지지 않는다(위 215MB/s). 상한은 **프록시가 버퍼링하는 양**이다.
   */
  experimental: {
    proxyTimeout: 6 * 60 * 1000,
    proxyClientMaxBodySize: 512 * 1024 * 1024,
  },

  /**
   * 동일 출처 프록시.
   *
   * 왜 CORS 직접 호출이 아닌가 — 백엔드 `main.py` 의 `allow_origins=["*"]` 는
   * **개발 단계 설정**이고 상용에서 조여진다고 주석에 적혀 있다. 그때 프런트를
   * 고쳐야 하는 구조를 지금 만들지 않는다.
   *
   * 경로를 `/api/v1/pipeline` 로 **그대로** 맞춘 이유 — `status.json` 의
   * `artifacts` 값이 `/api/v1/pipeline/runs/<id>/artifacts/<name>` 절대경로로
   * 온다. 경로를 바꾸면 프런트가 그 문자열을 조립·치환해야 하고, 그 순간
   * 계약 4절("가공하지 않고 그대로")이 프런트에서 깨진다.
   */
  async rewrites() {
    /**
     * DEMO 빌드(`NEXT_PUBLIC_DEMO_RUN`)에는 백엔드가 없다. 브라우저의 `/api/v1/*` 는
     * `src/instrumentation-client.ts` 가 녹화로 답하므로 여기까지 오지 않고, 온다면
     * 그건 재생 밖의 요청이다 — `127.0.0.1:8000` 같은 기본값으로 넘기지 않고 404 로 둔다.
     */
    if (process.env.NEXT_PUBLIC_DEMO_RUN) return [];
    return [
      {
        source: "/api/v1/pipeline/:path*",
        destination: `${API_ORIGIN}/api/v1/pipeline/:path*`,
      },
      /**
       * 화면 5·6. 백엔드가 **같은 라우터를 두 prefix 로** 등록한다
       * (`main.py:161-170`) — 단수 `/simulation` · 복수 `/simulations`.
       *
       * 🔴 **복수형이 정본이다**(2026-08-11 백엔드 회신). 응답 안의 자기 링크
       *    (`result_url`·`pdf_url`·SSE `saved`)가 전부 복수형이라, 단수만 열어 두면
       *    **서버가 준 URL 을 그대로 fetch 할 수 없다.** 실제로 `hearings.ts` 가
       *    한동안 prefix 를 치환하고 있었다 — 경로 규칙이 서버와 프런트 두 곳에
       *    생기는 자리였다.
       *
       * ⚠ 단수도 남겨 둔다(백엔드가 호환용으로 유지한다). 여기서 지우면 단수로
       *   부르는 요청이 **백엔드 404 가 아니라 Next 404 페이지**로 떨어져 사유가
       *   안 보인다. 프런트 코드는 복수형만 쓴다(`simulation.ts` 머리말).
       */
      {
        source: "/api/v1/simulations/:path*",
        destination: `${API_ORIGIN}/api/v1/simulations/:path*`,
      },
      {
        source: "/api/v1/simulation/:path*",
        destination: `${API_ORIGIN}/api/v1/simulation/:path*`,
      },
      {
        source: "/api/v1/auth/:path*",
        destination: `${API_ORIGIN}/api/v1/auth/:path*`,
      },
      /**
       * 화면 1 업로드(2026-08-09 백엔드 재작성). 라우트 7개.
       *
       * 🔴 `bodySizeLimit` 을 여기서 안 건다 — 업로드는 rewrite 프록시를 그냥
       *    지나가고(Route Handler 가 아니다) 크기 제한은 백엔드가 정한다.
       *    프런트가 별도 상한을 두면 백엔드가 받아주는 파일을 프런트가 먼저
       *    거절하고, 그 거절 문구는 백엔드 정책과 어긋난다.
       */
      {
        source: "/api/v1/upload/:path*",
        destination: `${API_ORIGIN}/api/v1/upload/:path*`,
      },
      /**
       * 화면 5 B안(다인 토론)·HWPX 내려받기. 프런트 PR #57 ↔ 백엔드 PR #224.
       * 백엔드 `main.py:171-180` 에 `stakeholders` 2개 · `report` 1개가 있다.
       *
       * 🔴 PR 원본은 `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"`
       *    으로 **브라우저에서 직접** 백엔드를 불렀다. 세 가지가 걸린다 —
       *    ⓐ 백엔드 오리진이 번들에 박힌다(위 주석의 이유 그대로)
       *    ⓑ `allow_origins=["*"]` 라는 **개발용** CORS 설정에 의존한다
       *    ⓒ `localhost` 는 IPv6 `::1` 로 먼저 풀리는데 백엔드는 2026-08-09
       *       보안 조치로 `127.0.0.1` 에만 바인딩돼 있다(백엔드 CLAUDE.md 함정).
       *    그래서 나머지 넷과 **같은 방식**으로 접는다. 새 화면만 다른 규칙을
       *    쓰면 백엔드 주소가 바뀔 때 여기만 남는다.
       *
       * 🔴 **이 rewrite 를 타지 않는 경로가 둘 있다**(2026-08-14 · 2026-08-15).
       *    `/stakeholders/dynamic/discuss/stream` 과 `/stakeholders/generate` 는
       *    브라우저가 백엔드를 직접 부른다. Amplify Hosting 의 SSR compute 가
       *    응답을 버퍼링하다 **30초 벽**에서 본문 없는 오류를 만드는데, 토론은
       *    실측 55.7초 · 페르소나 발굴은 실측 29.2s 200 ↔ 30.0s 실패라 둘 다
       *    그 벽을 못 넘는다. 위 ⓐⓑⓒ 가 틀려서가 아니라 **그 값을 치를 수밖에
       *    없어서**다(ⓐ 는 감수, ⓑ 는 preflight 200 실측으로 해소, ⓒ 는 붙이는
       *    값이 공개 도메인이라 해당 없음). 근거 전부는 `simulation.ts` 의
       *    `BACKEND_ORIGIN` 머리주석에 있다.
       *
       * 🔴 **`/generate` 는 「SSE 가 아니니 괜찮다」고 판정했다가 틀린 자리다.**
       *    2026-08-14 에는 여기 「한 번에 받는 JSON 이라 버퍼링이 무해하다」고
       *    적혀 있었고, 하루 뒤 사용자 화면에 **HTTP 504 · 본문 없음**이 떴다.
       *    ⚠ **판정 기준은 응답 모양이 아니라 소요 시간이다.** 새 라우트를
       *      여기 얹을 때 물을 것은 「스트림인가」가 아니라 「30초를 넘는가」.
       *
       * ⚠ 아직 못 잰 후보가 둘 남아 있다(2026-08-15) — `POST /report/download/hwpx`
       *   (문서 생성)와 `POST /upload/*`(실측 248MB). 둘 다 30초를 넘을 수 있는데
       *   운영에서 재본 적이 없어 여기 적지 않는다. 재기 전에 옮기지도 않는다.
       */
      {
        source: "/api/v1/stakeholders/:path*",
        destination: `${API_ORIGIN}/api/v1/stakeholders/:path*`,
      },
      {
        source: "/api/v1/report/:path*",
        destination: `${API_ORIGIN}/api/v1/report/:path*`,
      },
      /**
       * 게시판(PR #62 ↔ 백엔드 `app/api/v1/posts.py`). 라우트 6개.
       *
       * 🔴 PR 원본은 `posts.ts:34` 에서 `NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api/v1"`
       *    로 **브라우저가 직접** 백엔드를 불렀다 — 바로 위 stakeholders 주석이
       *    적어둔 ⓐⓑⓒ 와 **같은 패턴**이다. 그 키는 이 저장소 어느 env 파일에도
       *    없어서(`.env.local` 에는 `OMNISITE_API_ORIGIN` 뿐) 폴백이 **항상** 걸렸다.
       *
       * 🔴 **`:path*` 는 빈 경로도 먹는다** — 목록 `GET /api/v1/posts` 와 작성
       *    `POST /api/v1/posts` 가 슬래시 없는 자리에 산다(백엔드 `posts.py:58·143`
       *    는 `""` 와 `"/"` 를 둘 다 등록한다). path-to-regexp 에서 `/:path*` 는
       *    앞 슬래시까지 포함해 0개 이상이라 `/api/v1/posts` 도 이 규칙에 걸린다.
       *
       *    실측(2026-08-12, dev 서버 :3000 ↔ 백엔드 :8000, 토큰 없이 GET) —
       *      `/api/v1/posts`      → **401 `application/json`** `{"detail":"인증 헤더…"}`
       *      `/api/v1/posts/1`    → 401 `application/json`
       *      `/api/v1/posts?page=1` → 401 `application/json`
       *      `/api/v1/posts/`     → 308 → `/api/v1/posts` (Next 의 슬래시 정규화)
       *    확인한 것은 「목록이 나온다」가 아니라 **「응답을 백엔드가 만들었다」**다 —
       *    규칙에 안 걸렸다면 Next 404 **HTML** 이 나온다. 401 JSON 이라는 건 요청이
       *    백엔드까지 갔다는 뜻이고, 그때 백엔드 사유가 화면까지 닿는다.
       */
      {
        source: "/api/v1/posts/:path*",
        destination: `${API_ORIGIN}/api/v1/posts/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: process.env.SENTRY_ORG || "YOUR_ORG_SLUG_HERE",
  project: process.env.SENTRY_PROJECT || "YOUR_PROJECT_SLUG_HERE",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Automatically annotate React components to show their full name in breadcrumbs and session replay
  reactComponentAnnotation: {
    enabled: true,
  },

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // 🔴 `hideSourceMaps: true` 가 여기 있었는데 **타입 에러로 빌드가 죽는다**
  //    (`TS2561 … does not exist in type 'SentryBuildOptions'`, next.config.ts:233).
  //    `@sentry/nextjs` v8 부터 클라이언트 번들에서 소스맵을 숨기는 게 **기본값**이 되며
  //    옵션 자체가 사라졌다 — 지운 것이지 끈 게 아니다. 동작은 그대로다.
  //    ⚠ `main_deploy`(6dc02f6) 단독으로도 같은 에러가 난다. 병합이 만든 게 아니다.

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
