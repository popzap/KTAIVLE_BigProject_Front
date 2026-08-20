# OmniSite — 실행 안내

> **B2G 공간의사결정지원 시스템(SDSS).** 갈등시설 입지 선정 —
> GIS 최적화(MCLP) + 다중 에이전트 공청회 시뮬레이션.
> MVP: 서울 용산구 흡연부스 / 2차: 성동구 재활용정거장.
>
> **이 문서 하나만 읽고 끝까지 실행할 수 있게 썼습니다.** 다른 문서를 찾아갈 필요가 없습니다.

| 구성요소 | 저장소 | 브랜치 | 주소 |
|---|---|---|---|
| 백엔드 (FastAPI) | `BigProject_Back` | `back_deploy` | http://127.0.0.1:8000 |
| 프런트엔드 (Next.js) | `BigProject_Front` | `main_deploy` | http://localhost:3000 |

---

## 0. 준비물

| 필요한 것 | 확인 명령 | 비고 |
|---|---|---|
| **Docker Desktop** | `docker --version` | 백엔드는 전부 도커 안에서 돕니다 — **로컬 파이썬 불필요** |
| **Node.js 20.9 이상** | `node --version` | 프런트엔드용. Next 16 이 `engines: >=20.9.0` 을 건다. **Node 24.16 / npm 11.13 에서 실측** |
| **데이터셋 ZIP** | — | 아래 [1단계](#1-데이터셋-배치) 참조 |

> 🔴 **Docker Desktop 이 실행 중**이어야 합니다. 아이콘이 초록색인지 먼저 보세요.
> 안 켜져 있으면 `docker compose` 가 `cannot connect to the Docker daemon` 으로 죽습니다.

---

## 1. 데이터셋 배치

원본 데이터는 용량이 커서 소스코드와 **따로** 배포합니다.
쓰는 파일은 **`AI 4조 데이터셋.zip`** 하나입니다 (35.0MB · 127개 파일 · 풀면 111.0MB).

```bash
# BigProject_Back 폴더 안에서 풉니다. ZIP 안에 datasets/ 가 통째로 들어 있으므로
# 폴더를 따로 만들 필요가 없습니다.
cd BigProject_Back
tar -xf "AI 4조 데이터셋.zip"        # 또는 탐색기에서 "여기에 압축 풀기"
```

풀고 나면 이렇게 됩니다 (2026-08-20 ZIP 실측 — 개수·용량은 압축 풀린 기준):

```
BigProject_Back/
└── datasets/
    ├── 흡연/            22개  24.8MB   MVP 도메인 — 원본 데이터 + 조례
    ├── 흡연_FIX/        12개   0.7MB   회귀 기준선 (5단계 자체점검이 이걸 씁니다)
    ├── 재활용/          18개   3.8MB   2차 도메인
    ├── 재활용_FIX/       6개   0.1MB
    ├── region_data/     26개  29.3MB   지적도 · 행정경계 · 크로스워크
    ├── search_cache/     5개   0.0MB
    ├── step1_output/     4개   0.1MB   ┐
    ├── step2_output/    24개  27.4MB   │ 정본 산출물
    ├── step3_output/     3개  23.8MB   │
    └── step4_output/     7개   1.0MB   ┘
```

> ⚠ 이 ZIP 에는 **`EV/` 도메인이 없습니다.** 실행에 필요한 두 도메인은 `흡연`·`재활용`
> 이고, 5단계 자체점검도 이 둘만 씁니다.

### 🔴 이 ZIP 을 쓰면 경계 SHP 3개를 따로 넣어야 합니다

제출 규정(100MB 상한)에 맞추려고 **공개 행정경계 파일 3개를 뺐습니다.**
우리가 만든 데이터가 아니라 통계청이 배포하는 원본이고, 이 셋만 304.7MB 입니다.

| 빼놓은 파일 | 크기 | 필수 |
|---|---|---|
| `datasets/region_data/BND_ADM_DONG_PG.shp` | 129MB | ✅ 필수 |
| `datasets/region_data/BND_SIGUNGU_PG.shp` | 93MB | ✅ 필수 |
| `datasets/region_data/BND_SIDO_PG.shp` | 83MB | 선택 |

같은 이름의 `.cpg`·`.dbf`·`.prj`·`.shx` 는 **그대로 들어 있는 것을 확인했습니다** —
빠진 건 `.shp` 확장자 3개뿐입니다. 아래 **전체본 `datasets.zip`**(약 393MB)에서 그 3개만
꺼내 같은 자리에 놓으면 됩니다.

<https://drive.google.com/file/d/1TAxlK0tCu_a1T4bZffj-yaKXggm0P68A/view?usp=drive_link>

<sub>⚠ 전체본 안에 그 3개가 들어 있다는 것은 이 문서를 쓰면서 열어 확인하지 않았습니다
(용량 때문). 없으면 통계청 SGIS 「행정구역경계」 원본을 받아도 같습니다.</sub>

> **없으면 어떻게 되나**: 서버는 정상 기동하고 화면도 뜹니다. 대신 파이프라인 STEP2 의
> 공간조인이 대상 폴리곤을 못 찾아 **지표가 전부 0** 이 됩니다. 안 터지고 값만 틀리므로
> 5단계 자체점검(`check_fixture.py`)을 꼭 돌려 확인하세요.

> 한글 폴더 이름(`흡연`·`재활용`)은 ZIP 안에 **UTF-8 로 표시돼 있어서**(106개 항목 전부
> 확인) 압축 프로그램이 깨뜨리지 않습니다. 그래도 풀고 나서 폴더 이름이 `?????` 로
> 보이면 그 압축 프로그램을 바꾸세요 — 백엔드는 폴더 이름으로 도메인을 찾습니다.

---

## 2. 환경변수 `.env`

`.env.example` 을 복사한 뒤 값을 채웁니다. **이 파일이 없으면 서버가 기동조차 못 합니다**
(`DATABASE_URL`·`REDIS_URL`·`SECRET_KEY` 는 기본값을 일부러 두지 않았습니다 —
기본값이 있으면 빠뜨렸을 때 조용히 약한 설정으로 뜹니다).

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

### 반드시 채워야 하는 5개

| 키 | 값 | 설명 |
|---|---|---|
| `POSTGRES_PASSWORD` | 임의의 긴 문자열 | 도커 DB 비밀번호. **`postgres` 같은 약한 값 금지** |
| `REDIS_PASSWORD` | 임의의 긴 문자열 | 도커 Redis 비밀번호 |
| `DATABASE_URL` | `postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/omnisite` | 위 비밀번호와 **같은 값**을 넣습니다 |
| `REDIS_URL` | `redis://:<REDIS_PASSWORD>@127.0.0.1:6379/0` | 위와 동일 |
| `SECRET_KEY` | 임의의 64자 hex | JWT 서명 키 |

비밀번호·키 생성 한 줄 (아무 데서나):

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### 선택 — 기능별로 필요한 키

| 키 | 없으면 못 하는 것 |
|---|---|
| `OPENAI_API_KEY` | 감리 AI(STEP1)·공청회 토론(화면5). **`fixture` 모드 시연에는 불필요** |
| `VWORLD_KEY` / `VWORLD_API_KEY` | 주소→좌표 지오코딩(새 지역 데이터를 넣을 때만) |
| `KAKAO_REST_API_KEY` | 지도 로드뷰 |
| `LAW_GO_KR_OC` / `DATA_GO_KR_KEY` | 상위법 자동 검색 |

> 🔴 **`localhost` 대신 `127.0.0.1` 을 쓰세요.** `localhost` 는 IPv6(`::1`)로 먼저 풀리는데
> 도커가 IPv4 에만 바인딩해서 **요청 하나가 130초** 걸린 적이 있습니다.
> (코드가 자동 교정하고 경고 로그를 남기지만, 애초에 안 겪는 게 낫습니다.)

---

## 3. 백엔드 실행 — 2줄

```bash
cd BigProject_Back

docker compose up -d --build
docker compose run --rm api python scripts/bootstrap_db.py --yes
```

* 1줄째: DB(PostgreSQL+PostGIS) · Redis · API 컨테이너 3개를 빌드하고 띄웁니다.
  첫 실행은 이미지 빌드 때문에 몇 분 걸립니다.
  **빈 DB 라면 `omnisite_seed.sql.gz` 가 자동으로 복원**되므로 따로 할 일이 없습니다.
* 2줄째: 시드 이후에 추가된 테이블(`run_records` 등)을 만들고 스키마를 맞춥니다.
  **시드를 복원했어도 반드시 한 번 칩니다** — 안 치면 조용히 몇 개가 빠집니다.

열립니다 → **<http://127.0.0.1:8000/docs>**

> `docker compose` 가 없다는 오류가 나면 구버전입니다. `docker-compose`(하이픈)로 바꿔 치세요.
> 운영 배포 스크립트도 하이픈 쪽을 씁니다.

**중지 / 재시작**

```bash
docker compose logs -f api     # 로그 보기
docker compose restart api     # API 만 재시작
docker compose down            # 전부 정지 (데이터는 볼륨에 남습니다)
```

---

## 4. 프런트엔드 실행 — 3줄

```bash
cd BigProject_Front

copy .env.example .env.local     # macOS/Linux: cp .env.example .env.local
npm install
npm run dev
```

열립니다 → **<http://localhost:3000>**

**2026-08-20 실측** — 방금 내려받은 폴더(`node_modules` 없음, `.env.local` 없음)에서
그대로 확인했습니다: `npm install` 501개 15초 · `npm ci` 501개 22초, 취약점 0건,
`npm run dev` 는 4.6초 만에 `Ready`. `npm install` 이 `package-lock.json` 을
건드리지 않는 것도 확인했으므로 **둘 중 아무거나 써도 됩니다**(재현성이 필요하면 `npm ci`).

`.env.local` 은 키가 **하나뿐**이고 기본값이 이미 맞습니다:

```
OMNISITE_API_ORIGIN=http://127.0.0.1:8000
```

> ⚠ 실은 **`.env.local` 이 없어도 뜹니다** — `next.config.ts` 가 같은 값을 기본값으로
> 들고 있습니다. 그래도 1줄째를 남겨 둔 이유는, 백엔드를 다른 주소에 두는 순간
> 고칠 파일이 있어야 하는데 그때 `next.config.ts` 를 고치게 하면 안 되기 때문입니다.
>
> 브라우저는 백엔드 주소를 모릅니다 — 항상 같은 출처(`/api/v1/...`)로만 부르고
> Next.js rewrite 가 위 주소로 넘깁니다. 백엔드를 다른 호스트에 두더라도
> **이 값 한 줄만** 바꾸면 됩니다.

> 🔴 **`npm run dev` 를 띄운 채로 `npm run build` 를 돌리지 마세요.** 둘이 같은 `.next/`
> 를 써서, 빌드가 dev 산출물을 덮어쓰면 그 뒤로 dev 서버가 500(`Unexpected token ':'`)
> 을 냅니다. 코드 오류처럼 보이지만 아닙니다 — `.next` 를 지우고 dev 를 다시 띄웁니다.

---

## 5. 제대로 떴는지 확인 (3분)

```bash
# ① API 문서가 열리는가
curl http://127.0.0.1:8000/docs

# ② 참조 데이터가 다 있는가  → [] 가 나와야 정상
docker compose exec api python -c "from app.config import missing_reference_files; print(missing_reference_files(required_only=True))"

# ③ 회귀 기준선과 값이 같은가 → 57/57 이 나와야 정상
docker compose exec api python app/tools/check_fixture.py 흡연
```

②에서 `행정동 경계 SHP`·`시군구 경계 SHP` 가 나오면 **1단계의 `.shp` 3개를 안 넣은 것**입니다.

③은 LLM 을 한 번도 부르지 않는 순수 대조입니다(비용 0). 후보 필지 수·배제 면적·
가중치까지 기준선과 대조하므로, 여기가 57/57 이면 파이프라인 전체가 정상입니다.

---

## 6. 화면 흐름

| 화면 | 하는 일 | 필요한 것 |
|---|---|---|
| 1 업로드 | 도메인별 원본 데이터·조례 업로드 | — |
| 2~3 감리·정제 | 감리 AI 가 데이터 의도·배제반경 제안 → **사람이 확정(HITL)** | `OPENAI_API_KEY` |
| 4 입지 선정 | MCLP 로 후보지 Top-N 산출, 지도에서 선택 | 경계 SHP |
| 5 공청회 | 선택한 입지로 다중 에이전트 토론 (A 대립형 / B 다인형) | `OPENAI_API_KEY` |
| 6 보고서 | PDF · HWPX 다운로드 | — |

**API 키 없이 시연하려면** 파이프라인 실행 모드를 `fixture` 로 두세요 —
미리 고정해 둔 기준선을 그대로 재생하므로 LLM 을 부르지 않고 화면 5까지 갑니다
(흡연 약 95초). 모드는 실행 요청(`POST /api/v1/pipeline/runs`)의 `mode` 필드입니다.

| 모드 | 뜻 | LLM |
|---|---|---|
| `fixture` | 고정 기준선 재생 (시연용, 대기 없음) | 호출 0회 |
| `hitl` | 프리셋 데이터 + 사람이 게이트에서 값 확정 | 호출함 |
| `full` | 업로드한 데이터로 STEP0부터 전부 | 호출함 |

---

## 7. 자주 나는 오류

| 증상 | 원인 | 처치 |
|---|---|---|
| 기동 시 `RuntimeError: … .env.example 을 복사…` | `.env` 없음/키 누락 | 2단계 |
| `POSTGRES_PASSWORD 를 .env 에 설정할 것` | compose 가 비밀번호를 못 찾음 | 2단계 |
| `cannot connect to the Docker daemon` | Docker Desktop 미실행 | 도커 켜기 |
| 화면은 뜨는데 **지표가 전부 0** | 경계 `.shp` 3개 없음 | 1단계 · 5단계 ② |
| `relation "…" does not exist` | 부트스트랩 안 함 | 3단계 2줄째 |
| 요청 하나가 **130초** 걸림 | `.env` 에 `localhost` 를 씀 | `127.0.0.1` 로 |
| 화면1 에 **「도메인 목록을 못 받았습니다 · 500 /api/v1/upload/domains」** | 백엔드가 안 떠 있음 | 3단계 먼저. 백엔드를 띄운 뒤 화면의 **「다시 시도」** |
| 화면5 가 **HTTP 500** 인데 백엔드는 멀쩡 | 프런트 프록시 타임아웃 (기본 30초) | **이미 6분으로 늘려 두었습니다**(`next.config.ts` 의 `proxyTimeout`). 그래도 나면 백엔드 응답이 6분을 넘긴 것 |
| 프런트 `npm install` 실패 | Node 버전 | Node 20.9 이상 |
| dev 서버가 500 `Unexpected token ':'` | dev 를 띄운 채 `build` 를 돌림 | `.next` 삭제 후 dev 재시작 (4단계) |
| 🔴 화면5 토론이 **내 로컬 백엔드가 아니라 운영 서버**에서 돎 | `npm run build && npm start` 로 띄움 | **`npm run dev` 로 띄우세요.** 화면5 스트림만 `NODE_ENV=production` 일 때 `https://api.omnisite.o-r.kr` 로 직결합니다(`src/lib/omnisite/simulation.ts:238`). 안 터지고 **값만 남의 것**이 됩니다 |
| 콘솔에 `UnicodeEncodeError` | Windows cp949 콘솔 | `set PYTHONIOENCODING=utf-8` |

> **백엔드 없이 프런트만 먼저 띄워도 됩니다.** 2026-08-20 실측 — 화면은 정상적으로
> 그려지고 흰 화면이 되지 않으며, 브라우저 콘솔에도 에러가 남지 않습니다. 대신 서버에서
> 값을 받아야 하는 자리마다 **화면 안에 한국어로 사유와 HTTP 코드를 적습니다**
> (예: 화면1 프리셋 모드 → 「도메인 목록을 못 받았습니다 / 500 /api/v1/upload/domains
> — Internal Server Error / 다시 시도」). 가짜 값으로 채우지 않는 것이 이 앱의 원칙입니다.
> 로그인은 게시판에서만 필요하므로 파이프라인 화면은 로그인 없이 그대로 볼 수 있습니다.

---

## 8. 더 읽을 것 (실행에는 필요 없음)

**어느 저장소에 있는지**를 같이 적습니다 — 두 저장소를 다 받지 않았으면 없는 파일입니다.

| 문서 | 저장소 | 내용 |
|---|---|---|
| `CLAUDE.md` | `BigProject_Back` | 설계 원칙 · **실제로 겪은 함정 목록** |
| `docs/개발자_협업_가이드.md` | `BigProject_Back` | 팀 내부 협업 규칙 (백엔드 옛 README) |
| `docs/api_schema.md` | `BigProject_Back` | API 스키마 |
| `pipeline_run_contract.md` | `BigProject_Back` | 파이프라인 실행 API 계약 (프런트↔백엔드) |
| `docs/프런트엔드_개발_가이드.md` | `BigProject_Front` | 화면별 배선 · 게이트 판별 조건 · Tailwind 4 레이어 함정 (프런트 옛 README) |

> 프런트 저장소의 `CLAUDE.md` 는 AI 코딩 도구용 한 줄짜리 파일이라 위 백엔드 `CLAUDE.md`
> 와 다른 문서입니다.

---

## 9. 기술 스택

**백엔드** FastAPI · SQLAlchemy 2.0 (asyncpg) · PostgreSQL + PostGIS · Redis ·
GeoPandas / Shapely · LangChain + LangGraph · pgvector · playwright(PDF)

**프런트엔드** Next.js 16.3 (Turbopack) · React 19.2 · TypeScript 6 · Tailwind CSS 4 ·
지도는 **의존성 없이 canvas 직접 렌더링** · Sentry · `@microsoft/fetch-event-source`(화면5 SSE)

> 🔴 **정정 (2026-08-20).** 이 줄에 원래 **Leaflet** 이 적혀 있었는데 **틀린 문장이었습니다.**
> `package.json` 에 `leaflet` 이 없고, `src/components/map/GridMap.tsx` 가 헤더 주석에
> 안 쓴 이유를 셋으로 적어 두고 있습니다 — ① 폐쇄망 납품 가능성 ② 6,797개 셀을 DOM 으로
> 그리면 성능이 안 나옴 ③ 필요한 도형이 사각형과 원뿐. OSM 타일은 라이브러리 없이
> 직접 부르고, 타일을 못 받으면 그 사실을 화면에 표시합니다(격자·후보지는 타일 없이도 정확).

**인프라** Docker Compose · GitHub Actions → AWS EC2 · AWS Amplify
