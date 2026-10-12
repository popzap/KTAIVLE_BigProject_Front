/**
 * DEMO 기록을 `public/demo/<run_id>/` 로 옮긴다 (`predev`·`prebuild`).
 *
 * `NEXT_PUBLIC_DEMO_RUN` 이 있으면 `demo-recording/<run_id>/` 를 복사하고,
 * 없으면 `public/demo/` 를 지운다 — 데모가 아닌 빌드에 녹화가 같이 실려 나가지 않게.
 * 값은 Next 와 같은 규칙으로 `.env*` 에서 읽는다(`@next/env`). npm 스크립트 단계에서는
 * Next 가 아직 `.env.local` 을 안 읽었기 때문이다.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";

const root = process.cwd();
const dev = process.env.npm_lifecycle_event === "predev";
nextEnv.loadEnvConfig(root, dev);

const run = process.env.NEXT_PUBLIC_DEMO_RUN ?? "";
const out = join(root, "public", "demo");
rmSync(out, { recursive: true, force: true });

if (!run) {
  console.log("[sync-demo] NEXT_PUBLIC_DEMO_RUN 없음 — 데모 아님, public/demo 비움");
  process.exit(0);
}

const src = join(root, "demo-recording", run);
if (!existsSync(join(src, "manifest.json"))) {
  console.error(`[sync-demo] ${src}/manifest.json 이 없다 — NEXT_PUBLIC_DEMO_RUN=${run} 를 확인할 것`);
  process.exit(1);
}
cpSync(src, join(out, run), { recursive: true });
console.log(`[sync-demo] ${src} → public/demo/${run}`);
