/**
 * 앱이 상호작용 가능해지기 전에 한 번 돈다(Next `instrumentation-client` 규약).
 *
 * DEMO 모드면 여기서 `window.fetch` 를 감싼다 — 첫 화면의 첫 요청보다 먼저
 * 걸려 있어야 해서 컴포넌트 effect 가 아니라 이 자리다. 데모가 아니면 아무것도
 * 안 한다(`DEMO` 는 빌드 시 박히는 상수라 그 분기는 번들에서 빠진다).
 */
import { DEMO, installDemoFetch } from "@/lib/omnisite/demo";

if (DEMO) installDemoFetch();
