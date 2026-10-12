# 실제 실행 기록 r_20261012_001

포트폴리오 데모(백엔드 없음)가 재생할 실제 실행 기록이다. 프런트가 백엔드에 보낸 요청과 받은 응답을 `scripts/record_proxy.py` 로 그대로 적었다. 값을 만들거나 고친 것은 없다.

| 항목 | 값 |
|---|---|
| run_id | `r_20261012_001` |
| 도메인 | 흡연 (서울특별시 용산구 흡연부스) — 화면 1 프리셋 |
| 모드 | `hitl` + `auto_approve: true` (화면 1 「고속 자동 분석」) |
| 녹화 일시 | 2026-10-12 19:44:36 ~ 19:54:41 (KST) |
| 프런트 | `front_final` @ manifest `frontend.commit`, `npm run dev` |
| 백엔드 | `merge_Back` @ manifest `backend.commit`, `docker compose` |
| 요청 수 | 83건 (일반 80 · SSE 2 · 202 1) |
| 로그인 | 안 함. 전 구간 익명 run (`Authorization` 실은 요청 0건) |

모드를 `fixture` 가 아니라 `hitl` 로 둔 이유: 화면 1 UI 의 프리셋 갈래는 항상 `hitl` 을 보낸다. `fixture` 는 게이트가 없어 화면 2·3 흐름이 UI 와 달라진다. 「고속 자동 분석」이라 게이트 A·B 는 AI 제안값으로 자동 승인됐고, 그래서 게이트 확정 POST 는 기록에 없다.

## 화면별 커버

`screen` 은 요청의 Referer 경로로 정했다. `screen_marker` 는 녹화 중 사람이 넘긴 표시라 화면 전환 직후 몇 건이 이전 번호로 남아 있다.

| 화면 | 경로 | 건수 | 녹화된 호출 |
|---|---|---|---|
| 1 데이터 입력 | `/` | 4 | `GET /upload/domains` ×2 · `POST /pipeline/runs` (202) · 상태 1 |
| 2 감리 확인 | `/audit` | 48 | 상태 폴링 · 산출물 `reviewed`·`clean_report`·`report`·`exclusion` · `hearings` |
| 3 가중치 | `/weights` | 2 | 산출물 `weight_set` · `hearings` |
| 4 위치 선정 | `/sites` | 3 | 산출물 `score_grid`·`topN` · `hearings` (후보 1순위 `422 대` 선택) |
| 5 토론 선택 | `/hearing/select` | 5 | `hearings` · 상태 |
| 5A 대립 토론 | `/hearing` | 7 | `candidates` · `hearings` · **SSE `POST /simulations/stream`** |
| 5B 다인 토론 | `/dynamic-hearing` | 6 | `candidates` · `hearings` · `reviewed` · **`POST /stakeholders/generate`** · **SSE `POST /stakeholders/dynamic/discuss/stream`** |
| 6 보고서 | `/report` | 8 | 산출물 `report`·`topN`·`clean_report` · `hearings` · `GET /simulations/results/862` (A) · `GET /simulations/hearings/b/20` (B) |

상태 폴링 `GET /pipeline/runs/{run_id}` 은 전 화면 합쳐 46건이다(1.5초 간격, 실행 중일 때).

### 화면 5 입력값

- A: 후보 `parcel_id 862` (화면 4 순위 1, `422 대`)
- B: 주제 `서울특별시 용산구 흡연부스`(화면 자동 채움) · 목적 `지역상권 활성화 및 담배꽁초 무단투기 방지`(입력칸 Tab 예시문) · 발굴 6명 중 상위 3명(지역 주민 · 흡연자 · 주변 어린이 및 어린이집 학부모)

### 스트림 측정값 (이 녹화에서 잰 값)

| 호출 | 상태 | 이벤트 | 첫 패킷 | 전체 |
|---|---|---|---|---|
| `POST /simulations/stream` (A) | 200 | 1,599 | 1,321 ms | 37,803 ms |
| `POST /stakeholders/generate` (B) | 200 | — | — | 22,674 ms |
| `POST /stakeholders/dynamic/discuss/stream` (B) | 200 | 42 | 915 ms | 39,619 ms |

파이프라인 무인 구간 Σsec 은 59.4초다(`status.json` 의 `steps[].sec` 합, 8칸). 녹화 세션 시각(약 10분)은 사람이 화면을 넘긴 시간이 섞여 있어 성능 지표가 아니다.

## 빠진 것

프런트 코드의 `/api/v1/` 호출 37개(`src/lib/omnisite/*` · `src/app/**`) 중 이번 녹화에 없는 것이다.

| 엔드포인트 | 빠진 이유 |
|---|---|
| `POST /pipeline/runs/{id}/hitl/audit` | 고속 자동 분석이라 게이트 A 를 서버가 자동 승인 |
| `POST /pipeline/runs/{id}/hitl/weight` | 같은 이유(게이트 B) |
| `GET /pipeline/runs/{id}/artifacts/facility` | `full` 모드 산출물. `hitl` run 에는 URL 이 없어 호출 안 됨 |
| `GET /upload/data?domain=` | 화면 2 STEP1 대기 화면(`full` 전용)과 업로드 화면에서만 호출 |
| `GET·POST·DELETE /upload/regulation(s)` · `POST·DELETE /upload/data` | 업로드 갈래. 프리셋이라 안 탐 |
| `DELETE /upload/domains/{domain}` · `DELETE /pipeline/runs/{id}` | 헤더 「처음부터 다시」(파괴적). 누르지 않음 |
| `POST /report/download/hwpx` | `/hearing-pdf`(하드코딩 표본 페이지)에만 있음. 이번 범위에서 제외 |
| 화면 6 PDF | `window.print()` 라 백엔드 호출이 없음 |
| `POST /auth/register` · `/auth/login` · `/auth/refresh` | 로그인 불필요(익명 run) |
| `GET /pipeline/runs?mine=true` | 마이페이지. 흐름 밖 |
| `GET·POST·PUT·DELETE /posts*` · `GET /posts/{id}/download` | 게시판. 흐름 밖 |
| `GET /pipeline/runs/{id}/log` | 프런트에 정의만 있고 호출하는 곳이 없음 |

백엔드가 아닌 것: 화면 4 지도 타일(`tile.openstreetmap.org`)은 브라우저가 직접 받으므로 기록에 없다.

## 파일 형식

```
manifest.json            녹화 순서(요청 도착 순) 목록과 실행 메타데이터
responses/NNN_<요약>.*   일반 응답 본문. 확장자는 Content-Type 기준(.json · .geojson · .csv)
requests/NNN_<요약>.json 요청 본문(있는 것만)
sse/NNN_<요약>.jsonl     SSE 이벤트. 한 줄에 {t_ms, event, data}
```

`manifest.json` 항목의 주요 키:

| 키 | 뜻 |
|---|---|
| `index` · `method` · `path` · `status` · `content_type` · `body_file` · `is_sse` · `screen` | 요구 형식 |
| `t_start_ms` | 녹화 시작부터 요청 도착까지 |
| `ttfb_ms` · `duration_ms` | 요청 도착부터 응답 헤더 / 응답 끝까지 |
| `first_packet_ms` | (SSE) 요청 도착부터 첫 본문 패킷까지 |
| `page` | 요청을 보낸 화면 경로(Referer) |
| `request_file` | 요청 본문 파일 |

SSE `t_ms` 는 첫 패킷부터의 경과 시간이다. 같은 속도로 재생하려면 요청 후 `first_packet_ms` 만큼 기다린 뒤 `t_ms` 간격으로 흘리면 된다. 한 네트워크 조각에 이벤트가 여럿 들어 있으면 같은 `t_ms` 를 갖는다. `data` 는 서버가 보낸 문자열 그대로다(JSON 이면 파싱 전 문자열).

## 마스킹

`Authorization`·쿠키 헤더는 저장하지 않는다. 본문은 `password`·`*_token`·`api_key` 같은 키와 `Bearer …`·JWT·`sk-…` 패턴을 `***MASKED***` 로 바꾸게 돼 있다. 이 녹화에서는 바꿀 값이 없었다(마스킹 0건). 검사:

```bash
grep -rniE "bearer|password|token" demo-recording/r_20261012_001
grep -rlE "eyJ[A-Za-z0-9_-]{5,}\.|sk-[A-Za-z0-9_-]{20,}" demo-recording/r_20261012_001
```

첫 줄은 `manifest.json` 의 `masking` 설명 문구 한 곳만 걸리고, 둘째 줄은 0건이다.

## 다시 녹화하려면

```bash
python scripts/record_proxy.py --out demo-recording/_session      # :8001 → :8000
# .env.local 의 OMNISITE_API_ORIGIN=http://127.0.0.1:8001 로 바꾼 뒤
npm run dev -- -H 127.0.0.1
curl "http://127.0.0.1:8001/__rec/screen?n=2"                     # 화면 표시(선택)
```

`npm run build && npm start` 로 띄우면 `directUrl()` 이 운영 백엔드를 직접 부르므로 녹화가 빠진다. 끝나면 `.env.local` 을 `:8000` 으로 되돌린다.
