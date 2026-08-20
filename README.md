# OmniSite — 실행 안내

> **B2G 공간의사결정지원 시스템(SDSS).** 갈등시설 입지 선정 —
> GIS 최적화(MCLP) + 다중 에이전트 공청회 시뮬레이션.
>
> **이 문서 하나만 읽고 끝까지 실행할 수 있게 썼습니다.**

| 구성요소 | 폴더 | 주소 |
|---|---|---|
| 백엔드 (FastAPI) | `BigProject_Back` | http://127.0.0.1:8000 |
| 프런트엔드 (Next.js) | `BigProject_Front` | http://localhost:3000 |

---

## 0. 준비물

| 필요한 것 | 확인 명령 | 비고 |
|---|---|---|
| **Docker Desktop** (실행 중) | `docker --version` | 백엔드는 전부 도커 안 — **로컬 파이썬 불필요** |
| **Node.js 20.9 이상** | `node --version` | 프런트엔드용 (Node 24.16 / npm 11.13 에서 확인) |
| **`AI 4조 데이터셋.zip`** | — | 1단계 |

---

## 1. 데이터셋 배치

```bash
cd BigProject_Back
tar -xf "AI 4조 데이터셋.zip"      # 또는 탐색기에서 "여기에 압축 풀기"
```

ZIP 최상위가 `datasets/` 라 폴더를 따로 만들 필요가 없습니다. 풀고 나면:

```
BigProject_Back/datasets/
├── 흡연/  흡연_FIX/          MVP 도메인 + 회귀 기준선
├── 재활용/  재활용_FIX/       2차 도메인 + 회귀 기준선
├── region_data/              지적도 · 행정경계 · 크로스워크
├── search_cache/
└── step1_output/ ~ step4_output/    정본 산출물
```

### 🔴 경계 SHP 3개는 따로 넣어야 합니다

제출 규정(100MB 상한) 때문에 통계청 배포 원본 3개(304.7MB)를 뺐습니다.

| 빼놓은 파일 | 크기 | 필수 |
|---|---|---|
| `datasets/region_data/BND_ADM_DONG_PG.shp` | 129MB | ✅ |
| `datasets/region_data/BND_SIGUNGU_PG.shp` | 93MB | ✅ |
| `datasets/region_data/BND_SIDO_PG.shp` | 83MB | 선택 |

같은 이름의 `.cpg`·`.dbf`·`.prj`·`.shx` 는 들어 있습니다. **`.shp` 3개만** 전체본
`datasets.zip`(약 393MB)에서 꺼내 같은 자리에 놓으세요.

<https://drive.google.com/file/d/1TAxlK0tCu_a1T4bZffj-yaKXggm0P68A/view?usp=drive_link>

> **없으면**: 서버는 뜨고 화면도 나오는데 STEP2 공간조인이 폴리곤을 못 찾아
> **지표가 전부 0** 이 됩니다. 안 터지고 값만 틀리므로 5단계 ②·③을 꼭 돌리세요.

---

## 2. 환경변수 `.env`

`BigProject_Back` 에서:

```bash
copy .env.example .env      # macOS/Linux: cp .env.example .env
```

**이 파일이 없으면 서버가 기동조차 못 합니다.** 반드시 채울 5개:

| 키 | 값 |
|---|---|
| `POSTGRES_PASSWORD` | 임의의 긴 문자열 (`postgres` 같은 약한 값 금지) |
| `REDIS_PASSWORD` | 임의의 긴 문자열 |
| `DATABASE_URL` | `postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/omnisite` |
| `REDIS_URL` | `redis://:<REDIS_PASSWORD>@127.0.0.1:6379/0` |
| `SECRET_KEY` | 임의의 64자 hex |

```bash
python -c "import secrets; print(secrets.token_hex(32))"   # 값 생성
```

선택 — `OPENAI_API_KEY`(감리 AI·공청회 토론. `fixture` 시연에는 불필요) ·
`VWORLD_KEY`(지오코딩) · `KAKAO_REST_API_KEY`(로드뷰) · `LAW_GO_KR_OC`(상위법 검색).

> 🔴 **`localhost` 대신 `127.0.0.1`.** `localhost` 는 IPv6 로 먼저 풀리는데 도커가
> IPv4 에만 바인딩해서 **요청 하나가 130초** 걸린 적이 있습니다.

---

## 3. 백엔드 실행 — 2줄

```bash
cd BigProject_Back

docker compose up -d --build
docker compose run --rm api python scripts/bootstrap_db.py --yes
```

* 1줄째: DB(PostgreSQL+PostGIS) · Redis · API 를 띄웁니다. 첫 실행은 몇 분 걸립니다.
  **빈 DB 면 `omnisite_seed.sql.gz` 가 자동 복원**됩니다.
* 2줄째: 시드 이후 추가된 테이블을 만듭니다. **시드를 복원했어도 반드시 한 번 칩니다.**

열립니다 → **<http://127.0.0.1:8000/docs>**

```bash
docker compose logs -f api     # 로그
docker compose restart api     # API 만 재시작
docker compose down            # 정지 (데이터는 볼륨에 남습니다)
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

`.env.local` 은 키가 **하나뿐**이고 기본값이 이미 맞습니다:

```
OMNISITE_API_ORIGIN=http://127.0.0.1:8000
```

브라우저는 백엔드 주소를 모릅니다 — 같은 출처(`/api/v1/...`)로만 부르고 Next.js
rewrite 가 넘깁니다. 백엔드를 다른 호스트에 두면 **이 한 줄만** 바꾸면 됩니다.

> 반드시 **`npm run dev`** 로 띄우세요. `npm run build && npm start` 로 띄우면
> 화면5 토론만 로컬이 아니라 **운영 서버**로 나갑니다(7단계 표).

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
③은 LLM 을 안 부르는 순수 대조(비용 0)라, 57/57 이면 파이프라인 전체가 정상입니다.

---

## 6. 화면 흐름

| 화면 | 하는 일 | 필요한 것 |
|---|---|---|
| 1 데이터 입력 | 원본 데이터·조례 업로드 또는 프리셋 선택 | — |
| 2~3 감리·중요도 | 감리 AI 제안 → **사람이 확정(HITL)** | `OPENAI_API_KEY` |
| 4 위치 선정 | MCLP 로 Top-N 산출, 지도에서 선택 | 경계 SHP |
| 5 갈등 예측 | 다중 에이전트 공청회 토론 | `OPENAI_API_KEY` |
| 6 보고서 | PDF · HWPX 다운로드 | — |

**API 키 없이 시연하려면** 실행 모드를 `fixture` 로 두세요 — 고정 기준선을 재생해
LLM 없이 화면 5까지 갑니다(흡연 약 95초).

| 모드 | 뜻 | LLM |
|---|---|---|
| `fixture` | 고정 기준선 재생 (시연용, 대기 없음) | 0회 |
| `hitl` | 프리셋 데이터 + 사람이 게이트에서 확정 | 호출함 |
| `full` | 업로드한 데이터로 STEP0부터 전부 | 호출함 |

---

## 7. 자주 나는 오류

| 증상 | 원인 | 처치 |
|---|---|---|
| `cannot connect to the Docker daemon` | Docker Desktop 미실행 | 도커 켜기 |
| 기동 시 `RuntimeError: … .env.example 을 복사…` | `.env` 없음/키 누락 | 2단계 |
| `POSTGRES_PASSWORD 를 .env 에 설정할 것` | compose 가 비밀번호를 못 찾음 | 2단계 |
| `relation "…" does not exist` | 부트스트랩 안 함 | 3단계 2줄째 |
| 요청 하나가 **130초** | `.env` 에 `localhost` 를 씀 | `127.0.0.1` 로 |
| 화면은 뜨는데 **지표가 전부 0** | 경계 `.shp` 3개 없음 | 1단계 |
| 화면1 에 **「도메인 목록을 못 받았습니다 · 500」** | 백엔드가 안 떠 있음 | 3단계 → 화면의 **「다시 시도」** |
| 화면5 가 **HTTP 500** 인데 백엔드는 멀쩡 | 프록시 타임아웃 | 이미 6분으로 늘려 뒀습니다. 그래도 나면 백엔드가 6분을 넘긴 것 |
| 🔴 화면5 토론이 **내 로컬이 아닌 운영 서버**에서 돎 | `build && start` 로 띄움 | **`npm run dev`** 로. 안 터지고 값만 남의 것이 됩니다 |
| 프런트 `npm install` 실패 | Node 버전 | Node 20.9 이상 |
| dev 서버가 500 `Unexpected token ':'` | dev 를 띄운 채 `build` 를 돌림 | `.next` 삭제 후 dev 재시작 |
| 콘솔에 `UnicodeEncodeError` | Windows cp949 콘솔 | `set PYTHONIOENCODING=utf-8` |

> 백엔드 없이 프런트만 먼저 띄워도 됩니다. 흰 화면이 되지 않고, 값을 받아야 하는
> 자리마다 **화면 안에 사유와 HTTP 코드**를 적습니다. 가짜 값으로 채우지 않습니다.

---

## 8. 기술 스택

**백엔드** FastAPI · SQLAlchemy 2.0 (asyncpg) · PostgreSQL + PostGIS · Redis ·
GeoPandas / Shapely · LangChain + LangGraph · pgvector · playwright(PDF)

**프런트엔드** Next.js 16.3 (Turbopack) · React 19.2 · TypeScript 6 · Tailwind CSS 4 ·
지도는 의존성 없이 canvas 직접 렌더링 · Sentry

**인프라** Docker Compose · GitHub Actions → AWS EC2 · AWS Amplify
