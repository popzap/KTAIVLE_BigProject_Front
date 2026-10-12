"use client";
// Trigger HMR

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { UploadPanel, type UploadPanelHandle } from "@/components/upload/UploadPanel";
import {
  MODE_FULL,
  MODE_HITL,
  TOPN_DEFAULT,
  TOPN_MAX,
  USER_INPUT_MAX,
} from "@/lib/omnisite/pipeline";
import { useRun } from "@/lib/omnisite/RunProvider";
import { SCREENS } from "@/lib/omnisite/screens";
import { fetchDomains, type DomainItem } from "@/lib/omnisite/upload";
import { DEMO } from "@/lib/omnisite/demo";

const SCREEN = SCREENS[0]!;

/**
 * 데이터 출처. 이 선택이 **mode 를 정한다** — 둘은 독립이 아니다.
 *
 *   upload → `full`.  `user_input` 필수 · `topn` 선택(기본 20)
 *   preset → `hitl`.  `user_input`·`topn` 을 같이 보내면 **400** 이다(계약 8-2).
 *
 * 🔴 **분석 모드(맞춤형/고속)는 여기와 다른 축이다.** 예전엔 「고속」을
 *    `mode="fixture"` 로 보냈는데 그건 **픽스처 재생**(`datasets/<도메인>_FIX/`
 *    가 있어야 한다)이지 자동승인이 아니다 — 픽스처가 없는 도메인은 400 이고,
 *    있어도 그 실행은 **지금 올린 데이터를 안 본다.** 지금은 mode 를 그대로 두고
 *    `auto_approve` 를 얹는다: 게이트는 서지만 그 자리를 AI 제안값으로 답한다
 *    (`pipeline_runner._run_auto_gate`). 그래서 **업로드 갈래에도 고속이 있다.**
 *
 * 실측 근거: `app/services/pipeline_runner.py` `_PLAN`·`start_run`.
 */
type DataSource = "upload" | "preset";

export default function Screen1Page() {
  const router = useRouter();
  const { run, starting, error, start } = useRun();

  const [dataSource, setDataSource] = useState<DataSource | null>(null);

  // 업로드 갈래에서 사람이 치는 도메인. 프리셋 갈래에서는 카드가 정한다.
  const [typedDomain, setTypedDomain] = useState<string | null>(null);
  const [presetDomain, setPresetDomain] = useState<string | null>(null);
  const domain =
    dataSource === "preset"
      ? (presetDomain ?? "")
      : (typedDomain ?? run?.domain ?? "");

  const [facility, setFacility] = useState("");
  const [region, setRegion] = useState("");
  const [intent, setIntent] = useState("");
  // 🔴 문자열로 들고 있는다. 숫자로 두면 지울 때 0 이 되고, 0 은 서버가 400 으로
  //    막는 **다른 값**이다. 빈 칸은 "안 정했다"이고 그때만 기본값 20 이 쓰인다.
  const [topnText, setTopnText] = useState(String(TOPN_DEFAULT));

  // 「고속 자동 분석」. mode 와 **다른 축**이다 — 게이트를 빼는 게 아니라
  // 그 자리를 AI 제안값으로 답한다. 그래서 두 갈래(upload/preset) 다 고를 수 있다.
  // DEMO: 기록된 실행이 고속(auto_approve)이라 그쪽을 먼저 골라 둔다. 바꿀 수는 있지만
  //       그러면 시작 요청이 녹화와 달라 재생되지 않는다(`demo.ts`).
  const [autoApprove, setAutoApprove] = useState(DEMO);
  const [inputError, setInputError] = useState<string | null>(null);

  const [activeStep, setActiveStep] = useState(1);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  // 「다음 단계」가 업로드를 기다리는 동안 참. 없으면 두 번 눌러 **같은 파일이
  // 두 번 올라간다** — 패널의 `busy` 는 자기 버튼만 막는다.
  const [step1Busy, setStep1Busy] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  const domainRef = useRef<HTMLInputElement>(null);
  /**
   * 업로드 패널의 손잡이. **「다음 단계」가 파일을 올린다**(2026-08-14 사람 지시).
   *
   * 🔴 「분석 시작하기」가 아니라 여기인 이유: 아래 `{activeStep === 1 && …}` 이라
   *    다음 칸으로 넘어가는 순간 패널이 **언마운트되고 고른 파일이 사라진다.**
   *    이 시점엔 패널이 아직 살아 있으므로 파일 목록을 부모로 끌어올릴 필요가 없다.
   */
  const uploadRef = useRef<UploadPanelHandle>(null);
  /**
   * 업로드가 **실제로 쓴** 폴더. `base` 는 사람이 친 이름, `actual` 은 겹쳐서
   * `_2` 가 붙었을 수도 있는 진짜 이름이다(`UploadPanel.resolveDomain`).
   *
   * 🔴 **파이프라인은 `actual` 로 돌려야 한다.** 파일은 `그늘막_2` 에 있는데
   *    `start("그늘막")` 을 치면 안 터지고 **빈 폴더로 분석한다** — 화면에는
   *    「정상 실행」으로 보이고 결과만 틀린다.
   * 🔴 사람이 Step 1 로 돌아가 이름을 고치면 무효다. `base` 를 같이 들고
   *    렌더 중에 대조한다.
   */
  const [uploadedDomain, setUploadedDomain] = useState<{
    base: string;
    actual: string;
  } | null>(null);
  /** 실행에 쓸 도메인. 겹쳐서 다른 폴더에 올라갔으면 **그쪽**이다. */
  const runDomain = uploadedDomain?.base === domain ? uploadedDomain.actual : domain;
  useEffect(() => {
    const el = domainRef.current;
    if (el && typedDomain === null && el.value.trim()) setTypedDomain(el.value);
  }, [typedDomain]);

  // 업로드는 `full`(STEP0 부터), 프리셋은 `hitl`(STEP2 부터). 「고속」은 mode 를
  // 바꾸지 않고 `autoApprove` 로 얹는다.
  const effectiveMode = dataSource === "upload" ? MODE_FULL : MODE_HITL;
  const isFull = effectiveMode === MODE_FULL;

  const topnParsed = parseTopn(topnText);

  /**
   * 서버로 실제 나가는 `user_input` **한 줄**.
   *
   * 🔴 「시설 유형」·「분석 지역」은 **자기 필드가 없다.** `RunRequest` 는
   *    `domain`·`mode`·`user_input`·`topn`·`auto_approve` 뿐이다(2026-08-24
   *    운영 스키마 실측). 그래서 두 값을 여기서 의도 문장 뒤에 붙여 STEP0.5
   *    프롬프트에 얹는다 — 계약을 안 바꾸고 LLM 에 힌트를 더 주는 유일한 경로다.
   *
   * 🔴 **빈 칸은 아예 안 붙인다.** `시설 유형: ` 처럼 값 없는 꼬리표를 남기면
   *    LLM 이 그걸 「미상」이라는 정보로 읽는다 — 안 적은 것과 다른 뜻이 된다.
   *
   * 🔴 **괄호+라벨 형식을 문장으로 녹이지 말 것.** 백엔드가 STEP0.5 를 실호출해
   *    대조한 결과(2026-08-24 회신 §3-2), 사용자가 시도를 안 적고 `분석 지역: 중구`
   *    만 준 경우 문장 형식(`중구에 … 부지 선정`)에서만 모델이 **`서울특별시 중구`
   *    로 시도를 지어냈다**(4/4 재현). 라벨이 있으면 「사용자가 여기까지만 적었다」는
   *    경계가 남는다. 지어낸 시도는 행정코드 검증을 조용히 통과해서 안 터지고
   *    값만 틀린다 — 「마포구 데이터가 용산구로 통과」 계열이다.
   */
  const userInput = (() => {
    const base = intent.trim();
    const hints: string[] = [];
    if (facility.trim()) hints.push(`시설 유형: ${facility.trim()}`);
    if (region.trim()) hints.push(`분석 지역: ${region.trim()}`);
    return hints.length > 0 ? `${base} (${hints.join(", ")})` : base;
  })();
  /**
   * 🔴 세는 대상은 **조합 결과**다. 사용자가 친 의도 문장이 아니다 — 꼬리
   *    `" (시설 유형: …, 분석 지역: …)"` 가 같은 200자를 먹는다(꼬리만 40자쯤
   *    된다). 의도 문장 길이로 세면 「196자인데 400」이 나온다.
   *    서버도 `strip()` 후를 세므로 `userInput` 은 이미 trim 된 상태다.
   */
  const userInputOver = isFull && userInput.length > USER_INPUT_MAX;

  async function handleStep1Confirm() {
    const fromDom = domainRef.current?.value ?? "";
    const value = (dataSource === "preset" ? domain : fromDom || domain).trim();
    if (!dataSource) {
      setStep1Error("데이터 출처를 먼저 선택해주세요.");
      return;
    }
    if (!value) {
      setStep1Error(
        dataSource === "preset"
          ? "프리셋 도메인을 하나 고르세요."
          : "분석 도메인이 비어 있습니다. 분석 대상을 입력해주세요. (예: 흡연)",
      );
      if (dataSource !== "preset") domainRef.current?.focus();
      return;
    }
    if (dataSource !== "preset" && fromDom.trim() && fromDom !== typedDomain) {
      setTypedDomain(fromDom);
    }
    setStep1Error(null);

    /*
     * 업로드 갈래에서만 — 고른 파일을 **여기서** 서버로 보낸다.
     *
     * 🔴 실패하면 넘어가지 않는다. 사유 문구는 **지어내지 않는다** — 패널이 이미
     *    자기 자리에 서버 응답을 그대로 적어놨다(같은 실패를 두 곳에서 다르게
     *    말하면 어느 쪽이 진짜인지 알 수 없다).
     * 🔴 올릴 게 없어도 `true` 다. `commit()` 은 「성공했다」가 아니라
     *    **「막을 이유가 없다」**를 돌려준다 — 이미 올려둔 사람은 그냥 지나간다.
     */
    if (dataSource === "upload" && uploadRef.current) {
      setStep1Busy(true);
      try {
        const actual = await uploadRef.current.commit();
        if (actual === null) return;
        // 🔴 이름이 겹치면 패널이 `그늘막_2` 에 올린다. 그 사실을 **여기서 받아
        //    들고 있어야** `onRun` 이 같은 폴더로 실행한다.
        setUploadedDomain({ base: value, actual });
      } finally {
        setStep1Busy(false);
      }
    }

    setActiveStep(2);
  }

  function handleStep2Confirm() {
    if (isFull && !intent.trim()) {
      setStep2Error("full 모드는 사용자 의도가 필수입니다. STEP0.5 가 이 문장에서 시설·지역을 확정합니다.");
      return;
    }
    // 🔴 서버가 400 으로 막는 값이라 여기서 먼저 막는다. 다만 문구는 **조합 후**를
    //    말한다 — 「의도 문장을 줄이세요」로만 적으면 두 칸을 채운 사람이 원인을
    //    못 찾는다(실제로 넘긴 건 꼬리를 합친 문장이다).
    if (userInputOver) {
      setStep2Error(
        `전송되는 문장이 ${userInput.length}자입니다. 상한은 ${USER_INPUT_MAX}자예요 — ` +
          `「시설 유형」·「분석 지역」을 붙인 뒤 길이입니다. 의도 문장이나 두 칸을 줄여주세요.`,
      );
      return;
    }
    if (topnParsed === "invalid") {
      setStep2Error(`입지 선정 개수는 1~${TOPN_MAX} 사이의 정수여야 합니다.`);
      return;
    }
    setStep2Error(null);
    setActiveStep(3);
  }

  async function onRun() {
    const fromDom = domainRef.current?.value ?? "";
    const value = (dataSource === "preset" ? domain : fromDom || domain).trim();
    setInputError(null);

    /*
     * 🔴 **업로드가 실제로 쓴 폴더로 돈다.** 같은 이름이 이미 있으면 파일은
     *    `그늘막_2` 에 저장됐는데, 여기서 `그늘막` 을 보내면 파이프라인이
     *    **다른(혹은 빈) 폴더**를 읽는다 — 예외 없이 결과만 틀린다.
     *    프리셋 갈래는 카드가 정한 이름 그대로다(`uploadedDomain` 이 안 생긴다).
     */
    const target = uploadedDomain?.base === value ? uploadedDomain.actual : value;

    const id = await start(
      target,
      effectiveMode,
      isFull
        ? {
            // 🔴 `intent` 가 아니라 **합쳐진 문장**이다. 「시설 유형」·「분석 지역」이
            //    여기 실려야 STEP0.5 프롬프트에 들어간다(`userInput` 주석).
            user_input: userInput,
            // 빈 칸이거나 유효하지 않으면 아예 안 보낸다(기본값 20 사용). "invalid"는 이미 Step 2에서 막힌다.
            ...(topnParsed === "empty" || topnParsed === "invalid" ? {} : { topn: topnParsed as number }),
          }
        : undefined,
      autoApprove,
    );
    if (id) router.push("/audit");
  }

  return (
    <PageBody>
      <PageHeader
        screen={SCREEN}
        lead="분석할 지역과 시설을 정의하고, 필요한 데이터를 업로드하여 AI 최적화 파이프라인을 시작합니다."
      />

      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 mt-6 overflow-hidden min-h-0">
        
        {/* 전체 컨텐츠 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* Stepper */}
          <div className="flex items-center justify-between mb-10 pb-6 border-b border-gray-100">
            <div className="flex items-center gap-4 flex-1 pr-8">
              <StepIcon current={activeStep} stepNum={1} label="데이터 및 문서 업로드" />
              <div className="h-px flex-1 bg-gray-200" />
              <StepIcon current={activeStep} stepNum={2} label="분석 정보 설정" />
              <div className="h-px flex-1 bg-gray-200" />
              <StepIcon current={activeStep} stepNum={3} label="AI 분석 모드 선택" />
            </div>
            <div className="shrink-0 text-[11px] font-bold text-gray-500 uppercase tracking-widest px-4 py-1.5 bg-gray-50 rounded-full border border-gray-200">
              Step {activeStep} of 3
            </div>
          </div>

          {/* ── Step 1 ── */}
          {activeStep === 1 && (
            <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                </div>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-[1.25rem] font-bold text-gray-900 tracking-tight">데이터 및 문서 업로드</h2>

                </div>
              </div>

              {dataSource === null && <SourcePicker onPick={setDataSource} />}

              {dataSource === "upload" && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <BackLink onClick={() => setDataSource(null)} />
                  <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-800 mb-2">
                      분석 주제 <span className="text-blue-500">(필수)</span>
                    </label>
                    <input
                      ref={domainRef}
                      value={typedDomain ?? run?.domain ?? ""}
                      onChange={(e) => setTypedDomain(e.target.value)}
                      placeholder="예) 흡연, 전기차, 따릉이"
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-gray-50 hover:bg-white"
                    />
                  </div>

                  <div className="-mx-2 -mb-2">
                    <UploadPanel ref={uploadRef} domain={domain} />
                  </div>
                </div>
              )}

              {dataSource === "preset" && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <BackLink onClick={() => setDataSource(null)} />
                  <PresetPicker selected={presetDomain} onSelect={setPresetDomain} />
                </div>
              )}

              {step1Error && (
                <div className="mt-2 p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800">
                  {step1Error}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2 ── */}
          {activeStep === 2 && (
            <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                </div>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-[1.25rem] font-bold text-gray-900 tracking-tight">분석 정보 설정</h2>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-semibold text-gray-800 mb-2">분석 주제</label>
                  <div className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-gray-50 text-sm">
                    {domain ? (
                      <b className="font-mono text-gray-900">{domain}</b>
                    ) : (
                      <span className="text-gray-400">— Step 1 에서 먼저 정합니다</span>
                    )}
                  </div>
                  {/*
                    🔴 **`_2` 를 알리는 유일한 자리다**(2026-08-14 사람 지시:
                       도메인 칸을 고칠 때마다 뜨지 말고 「다음 단계」를 지난 뒤
                       여기서 조그맣게). 같은 이름이 이미 있어서 다른 폴더에 올라갔다는
                       사실을 아예 안 적으면, 나중에 마이페이지 run 목록에 `그늘막_2`
                       가 떴을 때 그게 자기 실행인지 알 방법이 없다.
                       ⚠ 위 칸은 계속 사람이 친 이름을 보여준다 — 바뀐 것은 저장 폴더지
                         분석 주제가 아니다.
                  */}
                  {runDomain !== domain && (
                    <p className="mt-1.5 text-xs text-gray-400">
                      같은 이름이 이미 있어 저장 폴더는{" "}
                      <code className="font-mono text-gray-500">{runDomain}</code> 입니다. 이번
                      분석은 이 폴더로 돌아갑니다.
                    </p>
                  )}
                </div>

                {/* 🔴 이 두 칸은 **자기 필드로 안 간다.** `RunRequest` 에 그런 칸이
                    없다(운영 스키마 실측 2026-08-24: `domain`·`mode`·`user_input`·
                    `topn`·`auto_approve` 뿐). 그래서 아래 「사용자 의도」 문장 뒤에
                    붙여 STEP0.5 프롬프트에 얹는다 — 계약을 안 바꾸고 LLM 에 힌트를
                    더 주는 유일한 경로다. 합쳐진 문장은 아래에 그대로 보여준다. */}
                <Field
                  label="시설 유형 (선택)"
                  placeholder="예) 흡연부스"
                  value={facility}
                  onChange={setFacility}
                  note={isFull ? "적으면 「사용자 의도」 문장 뒤에 붙어 함께 전송됩니다." : undefined}
                />
                {/* 🔴 시도(광역)까지 적게 유도한다. STEP0.5 는 region 을
                    `<시도> <시군구>` 로 받고 그 값이 조례 검색과 행정코드 검증에
                    그대로 쓰인다. 「중구」처럼 시군구만 주면 서울·부산·대구·인천·
                    대전·울산 중 어디인지 모른다 — 비워두는 편이 낫지, 반쪽으로
                    적는 게 제일 위험하다(백엔드 회신 §3-3). */}
                <Field
                  label="분석 지역 (선택)"
                  placeholder="예) 서울특별시 용산구"
                  value={region}
                  onChange={setRegion}
                  note={
                    isFull
                      ? "적으면 「사용자 의도」 문장 뒤에 붙어 함께 전송됩니다. 시도까지 적어주세요 — 「중구」처럼 시군구만 적으면 어느 시도인지 알 수 없습니다."
                      : undefined
                  }
                />

                <div className="sm:col-span-2">
                  <Field
                    label={
                      isFull ? "사용자 의도 (필수)" : "사용자 의도 (이 모드에서는 전송되지 않음)"
                    }
                    placeholder="예) 용산구 흡연부스 부지 선정"
                    value={intent}
                    onChange={setIntent}
                    disabled={!isFull}
                    note={
                      isFull
                        ? `STEP0.5 가 이 문장에서 시설·지역을 확정합니다. 위 두 칸을 붙인 뒤 ${USER_INPUT_MAX}자까지, '--' 로 시작할 수 없습니다.`
                        : undefined
                    }
                  />
                  {/* 🔴 **보내는 문자열을 그대로 보여준다.** 위 두 칸을 뒤에 붙이는 순간
                      「내가 친 문장」과 「서버가 받는 문장」이 달라진다 — 말하지 않으면
                      화면이 거짓말한 것이다(원칙 4 · `Field.note` 주석과 같은 이유).
                      붙일 게 없으면 원문과 같으므로 굳이 두 번 보여주지 않는다.
                      ⚠ 단 **넘쳤을 때는 붙일 게 없어도 보여준다** — 상한을 넘긴
                      사람에게 글자 수를 안 보여주면 얼마나 줄여야 하는지 모른다. */}
                  {isFull && (userInput !== intent.trim() || userInputOver) && (
                    <div
                      className={`mt-2 rounded-lg border px-3 py-2 ${
                        userInputOver ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50"
                      }`}
                    >
                      <p
                        className={`text-xs font-semibold ${
                          userInputOver ? "text-red-700" : "text-gray-500"
                        }`}
                      >
                        실제로 전송되는 문장{" "}
                        <span className="font-normal tabular-nums">
                          ({userInput.length}/{USER_INPUT_MAX}자)
                        </span>
                      </p>
                      <p
                        className={`mt-1 font-mono text-xs leading-relaxed break-all ${
                          userInputOver ? "text-red-800" : "text-gray-700"
                        }`}
                      >
                        {userInput}
                      </p>
                      {userInputOver && (
                        <p className="mt-1.5 text-xs font-medium text-red-600">
                          {userInput.length - USER_INPUT_MAX}자 초과입니다. 이대로 보내면 서버가 400
                          으로 막습니다.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <Field
                    label={
                      isFull
                        ? "입지 선정 개수 (Top-N)"
                        : "입지 선정 개수 (이 모드에서는 전송되지 않음)"
                    }
                    placeholder={String(TOPN_DEFAULT)}
                    value={topnText}
                    onChange={setTopnText}
                    disabled={!isFull}
                    inputMode="numeric"
                    note={
                      isFull
                        ? `STEP4 가 뽑을 후보 개수입니다 — 화면4 목록의 길이이자 화면5 가 고를 수 있는 후보의 수입니다. 비우면 서버 기본값 ${TOPN_DEFAULT} 이 쓰입니다. 범위 1~${TOPN_MAX}.`
                        : undefined
                    }
                  />
                  {isFull && topnParsed === "invalid" && (
                    <p className="mt-1.5 text-xs font-medium text-red-600">
                      정수 1~{TOPN_MAX} 만 됩니다. 지금 값은 서버가 400 으로 막습니다.
                    </p>
                  )}
                </div>

                {step2Error && (
                  <div className="sm:col-span-2 p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800">
                    {step2Error}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3 ── */}
          {activeStep === 3 && (
            <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-[1.25rem] font-bold text-gray-900 tracking-tight">AI 분석 모드 선택</h2>
                </div>
              </div>

              <PremiumModePicker autoApprove={autoApprove} onChange={setAutoApprove} />

              {inputError && (
                <div className="mt-2 p-4 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-900">
                  {inputError}
                </div>
              )}

              {error && (
                <div className="mt-2 p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800 flex items-start gap-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  <div className="whitespace-pre-wrap break-all font-mono text-xs">{error}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 바닥 내비게이션 바 */}
        <div className="flex items-center justify-between px-8 py-5 border-t border-gray-100 bg-white shrink-0">
          <button 
             onClick={() => setActiveStep(activeStep - 1)}
             disabled={activeStep === 1 || starting}
             className="px-6 py-2.5 rounded-xl font-bold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-30 transition-colors"
          >
            <div className="flex items-center gap-2 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              이전 단계
            </div>
          </button>
          
          {activeStep === 3 ? (
            <button 
               onClick={onRun}
               disabled={starting || dataSource === null}
               className="px-8 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-md shadow-blue-200 disabled:bg-gray-300 disabled:shadow-none"
            >
              <div className="flex items-center gap-2 text-sm">
                {starting ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    파이프라인 가동 중...
                  </>
                ) : (
                  <>
                    분석 시작하기
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </>
                )}
              </div>
            </button>
          ) : (
            <button
               onClick={() => {
                 if (activeStep === 1) void handleStep1Confirm();
                 else handleStep2Confirm();
               }}
               disabled={step1Busy}
               className="px-8 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-md shadow-blue-200 disabled:opacity-60"
            >
              <div className="flex items-center gap-2 text-sm">
                {step1Busy ? "업로드 중..." : "다음 단계"}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </button>
          )}
        </div>
      </div>
    </PageBody>
  );
}

/**
 * `topnText` 를 서버에 보낼 값으로 바꾼다.
 *
 * 셋으로 갈리는 이유 — `""` 와 `"0"` 은 **다른 뜻**이다. 빈 칸은 "안 정했다"라
 * 서버 기본값에 맡기면 되고, `0` 은 서버가 400 으로 막는 틀린 값이다. 하나로
 * 뭉개면 사용자가 지운 것과 잘못 친 것이 같아진다.
 */
function parseTopn(text: string): number | "empty" | "invalid" {
  const t = text.trim();
  if (!t) return "empty";
  if (!/^\d+$/.test(t)) return "invalid";
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > TOPN_MAX) return "invalid";
  return n;
}

function StepIcon({ current, stepNum, label }: { current: number; stepNum: number; label: string }) {
  const isActive = current === stepNum;
  const isPast = current > stepNum;
  
  return (
    <div className={`flex items-center gap-3 transition-opacity ${isActive ? 'opacity-100' : 'opacity-40'}`}>
      <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[13px] font-bold shadow-sm ${
        isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'
      }`}>
        {isPast ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> : stepNum}
      </div>
      <span className={`text-[14px] font-bold ${isActive ? 'text-blue-900' : 'text-gray-500'}`}>
        {label}
      </span>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-6 flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      다른 방식 선택하기
    </button>
  );
}

function SourcePicker({ onPick }: { onPick: (s: DataSource) => void }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {/* DEMO: 업로드는 녹화 밖이다(파일을 받을 서버가 없다). 카드를 지우지 않고
          막는 이유 — 지우면 화면이 원래 무엇을 하는지 안 보인다. */}
      <button
        type="button"
        onClick={() => onPick("upload")}
        disabled={DEMO}
        title={DEMO ? "데모에서는 업로드를 쓰지 않습니다 — 프리셋 모드로 진행하세요" : undefined}
        className="flex flex-col items-center justify-center p-8 border-2 border-gray-200 rounded-2xl hover:border-blue-500 hover:bg-blue-50/50 transition-all duration-300 group disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:bg-transparent"
      >
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        </div>
        <h3 className="text-lg font-bold text-gray-800 mb-2">실제 데이터 업로드</h3>
        <p className="text-sm text-gray-500 text-center">
          분석하고 싶은 새로운 지역의 공간 데이터와 규정 문서를
          <br />
          직접 등록하여 처음부터 꼼꼼하게 분석을 시작합니다.
        </p>
      </button>

      <button
        type="button"
        onClick={() => onPick("preset")}
        className="flex flex-col items-center justify-center p-8 border-2 border-gray-200 rounded-2xl hover:border-indigo-500 hover:bg-indigo-50/50 transition-all duration-300 group"
      >
        <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
        </div>
        <h3 className="text-lg font-bold text-gray-800 mb-2">프리셋 모드 (DB 데이터)</h3>
        <p className="text-sm text-gray-500 text-center">
          시스템에 이미 잘 정제되어 저장된 지역 데이터를 골라
          <br />
          즉시 분석을 실행하고 결과를 빠르게 확인합니다.
        </p>
      </button>
    </div>
  );
}

/**
 * 프리셋 도메인 카드.
 *
 * 🔴 목록을 **화면이 들고 있지 않는다.** `GET /api/v1/upload/domains` 가 주는
 *    것만 그린다 — 도메인 이름은 도메인 값이라 프런트가 지어내면 원칙 2 위반이고,
 *    실제로 서버에 없는 도메인을 골라 400 을 맞게 된다.
 *
 * 🔴 「용산구 흡연부스」 같은 **표시명은 API 에 없다.** 응답에 있는 건
 *    `domain`·`law_files`·`data_files`·`has_audit_reviewed`·`has_fixture` 다.
 *    그래서 폴더명을 그대로 보여준다 — 예쁜 이름을 프런트에 적어두면
 *    도메인이 늘 때마다 화면이 거짓말한다.
 *    ⚠ 예전엔 「넷뿐이다(실측 2026-08-10)」라고 적혀 있었다. `has_fixture` 가
 *      나중에 생겼는데 이 주석만 안 고쳐져, **필드가 이미 있는데도 프런트가
 *      「서버가 안 준다」를 근거로 안내를 포기하고 있었다.**
 *      같은 이유로 `preexisting_files`·`root` 도 여기 적어둔다 — 지금 이 카드가
 *      안 그리는 필드가 있다면 그건 **없어서가 아니라 안 그려서**다.
 *
 * 🔴 `root` 는 이 행이 **어느 폴더에서 왔는지**다(백엔드 2026-08-14 루트 분리).
 *    **업로드 루트 행은 여기 안 그린다**(2026-08-16 사람 지시). 프리셋 모드는
 *    「우리가 미리 넣어둔 배포 원본으로 도는 시연 경로」이고, 사용자가 올린
 *    `datasets/user_input/<도메인>` 은 업로드 모드 소관이다 — 두 모드를 가르는
 *    것이 곧 두 폴더를 가르는 것이다.
 *    ⚠ 예전엔 두 루트를 같이 그리고 배지로만 구분했다. 근거는 「업로드
 *      도메인도 기준선만 있으면 같은 모드로 돈다」였는데, **그 전제가 성립한
 *      적이 없다**: 운영 실측(2026-08-16) 업로드 행 셋 다 `has_fixture:false`
 *      라 다섯 장 중 세 장이 눌러도 무조건 400 인 카드였다.
 *
 * 🔴 거르는 조건은 `!== "upload"` 다. `=== "preset"` 으로 쓰면 안 된다 —
 *    `root` 가 **없는 응답이 정상**이고(루트 분리 전 서버), 그 서버에서는
 *    카드가 **통째로 사라져** 프리셋 모드가 먹통이 된다. 아는 것만 뺀다
 *    (`upload.ts:DomainItem.root` 의 「모르면 예전처럼 그린다」와 같은 규칙).
 */
function PresetPicker({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (d: string) => void;
}) {
  const [items, setItems] = useState<DomainItem[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** 「다시 시도」용. 값 자체엔 의미가 없고 effect 를 한 번 더 돌리는 방아쇠다. */
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * 🔴 `setFailure(null)` 을 첫 await **앞**에 두면 그게 곧 effect 본문의 동기
   *    setState 라 `react-hooks/set-state-in-effect` 에 걸린다. 상태 초기화를
   *    응답이 온 뒤로 미루면 규칙도 만족하고, 재시도 중에 옛 오류가 잠깐
   *    사라졌다 다시 뜨는 깜빡임도 없다.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = (await fetchDomains()).filter((d) => d.root !== "upload");
        if (cancelled) return;
        setItems(list);
        setFailure(null);
      } catch (e) {
        if (cancelled) return;
        setItems(null);
        setFailure(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (failure !== null) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-semibold">도메인 목록을 못 받았습니다.</p>
        <p className="mt-1 font-mono text-xs break-all">{failure}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (items === null) {
    return <p className="text-sm text-gray-500">도메인 목록을 불러오는 중…</p>;
  }

  if (items.length === 0) {
    /**
     * 🔴 「서버에 등록된 도메인이 없습니다」라고 쓰면 안 된다 — 위에서 업로드
     *    루트를 걸러냈으므로, **올린 도메인은 있는데 배포 원본만 없는** 경우가
     *    여기로 온다. 그때 「없다」고 하면 화면이 틀린 말을 한다(원칙 5).
     *    같은 이유로 「업로드로 먼저 올리세요」도 지웠다 — 올려도 이 목록엔
     *    안 뜬다.
     */
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        시연용 배포 원본 도메인이 서버에 없습니다. 직접 올린 데이터로 돌리려면
        「다른 방식 선택하기」에서 <b>실제 데이터 업로드</b>를 고르십시오.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((d) => {
          const on = d.domain === selected;
          return (
            <button
              key={d.domain}
              type="button"
              onClick={() => onSelect(d.domain)}
              className={`text-left rounded-2xl border-2 p-5 transition-all duration-200 ${
                on
                  ? "border-indigo-500 bg-indigo-50/40 shadow-md ring-4 ring-indigo-500/10"
                  : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-bold text-gray-900 break-all">{d.domain}</h3>
                <span
                  className={`shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 ${
                    on ? "border-indigo-600 bg-indigo-600" : "border-gray-300 bg-white"
                  }`}
                />
              </div>
              {/**
                * `root` 를 안 주는 서버면 아무 배지도 안 단다(위 주석).
                * 「내가 올린 데이터」 배지가 있었는데 지웠다 — 그 행은 위 필터에서
                * 빠지므로 여기 닿지 않는다.
                */}
              {d.root === "preset" && (
                <span className="mt-2 inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  배포 원본 · 읽기 전용
                </span>
              )}
              <dl className="mt-3 space-y-1 text-[12px] text-gray-600">
                <div className="flex justify-between">
                  <dt>조례 문서</dt>
                  <dd className="tnum font-medium">{d.law_files}건</dd>
                </div>
                <div className="flex justify-between">
                  <dt>분석 데이터</dt>
                  <dd className="tnum font-medium">{d.data_files}건</dd>
                </div>
                <div className="flex justify-between">
                  <dt>감리 확정본</dt>
                  <dd className="font-medium">{d.has_audit_reviewed ? "있음" : "없음"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>재실행 기준선</dt>
                  <dd className="font-medium">{d.has_fixture ? "있음" : "없음"}</dd>
                </div>
              </dl>
              {d.data_files === 0 && (
                <p className="mt-3 text-[11px] leading-relaxed text-amber-700">
                  분석 데이터가 0건입니다 — STEP0 을 도는 모드로는 서버가 400 을 돌려줍니다.
                </p>
              )}
              {/**
                * 🔴 이 도메인은 **아래 두 모드 중 하나도 못 고른다.** 그 말을 카드에서
                *    안 하면, 모드를 고르고 「분석 시작」을 누른 **뒤에야** 400 을 만난다
                *    — 화면이 되는 것처럼 그려놓고 실행에서 죽는 건 조용한 실패다(원칙 1).
                * ⚠ **사유는 안 적는다.** 서버가 `has_fixture` 만 주고 막힌 이유는
                *   일부러 뺐다(저장소 절대경로가 새기 때문). 프런트가 「_FIX 폴더가
                *   없어서」 같은 말을 지어내면 그건 실측이 아니라 추측이다(원칙 4·5).
                */}
              {!d.has_fixture && (
                <p className="mt-3 text-[11px] leading-relaxed text-amber-700">
                  재실행 기준선이 없습니다 — 이 도메인은 <b>맞춤형 대화 분석</b>·
                  <b>고속 자동 분석</b> 두 모드 다 서버가 400 을 돌려줍니다. (사유는
                  서버가 알려주지 않습니다.)
                </p>
              )}
            </button>
          );
        })}
      </div>

    </>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  note,
  disabled,
  inputMode,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  /**
   * 이 값이 **어디로 가는지**. 안 적으면 사용자는 입력한 값이 서버로 간다고
   * 읽는다 — 모드에 따라 실제로는 아무 데도 안 가는 칸이 있다.
   * 화면이 말하지 않으면 화면이 거짓말한 것이다(원칙 4).
   */
  note?: string;
  disabled?: boolean;
  inputMode?: "numeric";
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-800 mb-2">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors bg-gray-50 hover:bg-white text-sm disabled:bg-gray-100 disabled:text-gray-400 disabled:hover:bg-gray-100"
      />
      {note && <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{note}</p>}
    </div>
  );
}

function PremiumModePicker({
  autoApprove,
  onChange,
}: {
  autoApprove: boolean;
  onChange: (v: boolean) => void;
}) {
  const options = [
    {
      value: false,
      title: "맞춤형 대화 분석 모드",
      badge: "추천",
      badgeColor: "bg-blue-100 text-blue-700",
      note: "분석 중간에 결과와 중요도에 대해 확인하고 수정할 수 있습니다.",
      pros: ["사용자가 직접 설정이 가능해 상세 설정이 가능합니다.", "정교한 맞춤형 최적화로 결과 도출이 가능합니다."],
      cons: ["시간이 조금 더 걸립니다."],
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
      )
    },
    {
      value: true,
      title: "고속 자동 분석 모드",
      note: "게이트에 서긴 하지만, 그 자리를 AI 제안값으로 자동 승인하고 지나갑니다.",
      pros: ["중간개입없이 빠르고 편리하게 분석을 할 수 있습니다.", "무엇을 자동 승인했는지 산출물에 남습니다."],
      cons: ["사람이 값을 확인하지 않습니다 — 결과에 「AI 제안값 자동승인」으로 표시됩니다."],
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m13 2-2 2.5-3-1v4.5l-3 1.5 2.5 2-1 3 4.5-1 1.5 3 2-2.5 3 1v-4.5l3-1.5-2.5-2 1-3-4.5 1-1.5-3z"></path></svg>
      )
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {options.map((o) => {
        const isSelected = autoApprove === o.value;
        return (
          <div
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={`cursor-pointer rounded-2xl border-2 p-6 transition-all duration-300 flex flex-col h-full ${
              isSelected
                ? "border-blue-500 bg-blue-50/40 shadow-md ring-4 ring-blue-500/10"
                : "border-gray-200 bg-white hover:border-blue-300 hover:bg-gray-50 hover:shadow-sm"
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`p-3 rounded-xl transition-colors duration-300 ${isSelected ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}>
                {o.icon}
              </div>
              {o.badge && (
                <span className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-wide ${o.badgeColor}`}>
                  {o.badge}
                </span>
              )}
            </div>

            <h3 className={`text-lg font-bold mb-2 transition-colors duration-300 ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
              {o.title}
            </h3>

            <p className="text-sm text-gray-500 leading-relaxed">
              {o.note}
            </p>

            <div className="mt-4 space-y-2">
              <div className="text-[13px]">
                <strong className="text-green-600 font-bold mr-1">장점:</strong>
                <ul className="list-disc pl-5 text-gray-600 mt-1 space-y-0.5">
                  {o.pros.map((pro, i) => <li key={i}>{pro}</li>)}
                </ul>
              </div>
              <div className="text-[13px]">
                <strong className="text-orange-500 font-bold mr-1">단점:</strong>
                <ul className="list-disc pl-5 text-gray-600 mt-1 space-y-0.5">
                  {o.cons.map((con, i) => <li key={i}>{con}</li>)}
                </ul>
              </div>
            </div>

          </div>
        );
      })}
    </div>
  );
}
