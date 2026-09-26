import { r2 } from "../r2";
import { BULLETIN_SERVICE_TYPES, type BulletinServiceType } from "./scripture-parser";
import { readScriptureWithGemini, renderBulletinFirstPage, scriptureModels, type ModelReading, type ScriptureSlots } from "./scripture-ai";
import { validateNkrvReference, type ValidatedReference } from "./scripture-validation";
import { assessScriptureHealth, type ExtractionRun, type HealthWarning } from "./scripture-health";

// 주보 성경봉독 자동 추출 파이프라인.
// 주보 수집 cron(금·토 6회)이 끝날 때마다 최근 주보 중 미완료 건을 처리한다.
// 두 모델의 판독이 일치하고 NKRV 에 실제 있는 구절이면 바로 게시(verified),
// 아니면 검토 대기(pending)로 두고 관리자에게 알린다. 관리자가 직접 넣은 칸은 건드리지 않는다.

/** cron 이 금·토 6회 돈다 — 과부하로 계속 실패해도 주말 안에 관리자에게 넘어가도록. */
export const MAX_SCRIPTURE_ATTEMPTS = 6;

type AdminClient = any; // service-role supabase client (프로젝트 전반과 동일하게 느슨한 타입)

export type SlotOutcome = {
  slot: BulletinServiceType;
  kind: "verified" | "pending" | "empty";
  confirmed: boolean;
  refs: Array<{ raw: string; valid: ValidatedReference | null }>;
  note?: string;
};

type Validator = (reference: string) => Promise<ValidatedReference | null>;

function sameLabels(a: Array<ValidatedReference | null>, b: Array<ValidatedReference | null>) {
  return a.length === b.length && a.every((item, index) => item != null && item.normalizedLabel === b[index]?.normalizedLabel);
}

/** 성공한 판독(앞의 두 개)을 칸별로 비교한다. 순수 함수 — 검증기만 주입. */
export async function decideSlots(slotsByModel: ScriptureSlots[], validate: Validator): Promise<SlotOutcome[]> {
  const [first, second] = slotsByModel;
  return Promise.all(BULLETIN_SERVICE_TYPES.map(async (slot): Promise<SlotOutcome> => {
    if (!first) return { slot, kind: "empty", confirmed: false, refs: [] };
    const validated = await Promise.all(slotsByModel.slice(0, 2).map((slots) => Promise.all(slots[slot].map(validate))));
    const pick = (index: number) => slotsByModel[index][slot].map((raw, i) => ({ raw, valid: validated[index][i] }));
    const allValid = (index: number) => validated[index].every(Boolean);

    if (!second) {
      if (!first[slot].length) return { slot, kind: "empty", confirmed: false, refs: [] };
      return { slot, kind: "pending", confirmed: false, refs: pick(0), note: "모델 1개만 응답" };
    }
    if (!first[slot].length && !second[slot].length) return { slot, kind: "empty", confirmed: true, refs: [] };
    if (sameLabels(validated[0], validated[1])) return { slot, kind: "verified", confirmed: true, refs: pick(0) };
    const preferred = allValid(0) || !allValid(1) ? 0 : 1;
    const other = slotsByModel[1 - preferred][slot].join(", ") || "없음";
    const note = allValid(0) && allValid(1) ? `모델 판독 불일치 (다른 판독: ${other})` : `성경에 없는 구절 포함 (다른 판독: ${other})`;
    return { slot, kind: "pending", confirmed: false, refs: pick(preferred), note };
  }));
}

function makeValidator(admin: AdminClient): Validator {
  const cache = new Map<string, Promise<ValidatedReference | null>>();
  return (reference) => {
    if (!cache.has(reference)) cache.set(reference, validateNkrvReference(admin, reference).catch(() => null));
    return cache.get(reference)!;
  };
}

const MODEL_TIMEOUT_MS = 25_000;

/**
 * 두 모델 응답을 받을 때까지 대체 모델을 순서대로 시도한다(남은 시간 안에서).
 * timeLimited: 함수 제한 시간 때문에 대체 모델을 못 부르거나 대기 시간을 줄여야 했던 경우 — 자가 진단 신호.
 */
async function collectReadings(png: Buffer, deadline: number): Promise<{ readings: ModelReading[]; timeLimited: boolean }> {
  const models = scriptureModels();
  let timeLimited = false;
  const timeoutFor = () => {
    const allowed = Math.max(5_000, Math.min(MODEL_TIMEOUT_MS, deadline - Date.now() - 2_000));
    if (allowed < MODEL_TIMEOUT_MS) timeLimited = true;
    return allowed;
  };
  const readings = await Promise.all(models.slice(0, 2).map((model) => readScriptureWithGemini(model, png, timeoutFor())));
  for (const model of models.slice(2)) {
    if (readings.filter((reading) => reading.ok).length >= 2) break;
    if (deadline - Date.now() < 10_000) { timeLimited = true; break; }
    readings.push(await readScriptureWithGemini(model, png, timeoutFor()));
  }
  // 두 결과를 다 받았다면 시간이 빠듯했어도 판독에는 지장이 없었다.
  return { readings, timeLimited: timeLimited && readings.filter((reading) => reading.ok).length < 2 };
}

async function saveOutcomes(admin: AdminClient, bulletinId: string, outcomes: SlotOutcome[]) {
  const { data: existing, error } = await admin.from("bulletin_scripture_readings").select("service_type,source").eq("bulletin_id", bulletinId);
  if (error) throw new Error(error.message);
  const manualSlots = new Set((existing || []).filter((row: { source: string }) => row.source === "manual").map((row: { service_type: string }) => row.service_type));
  const now = new Date().toISOString();
  for (const outcome of outcomes) {
    // 관리자가 직접 저장한 칸은 사람의 판단이 우선이다.
    if (manualSlots.has(outcome.slot)) continue;
    // 한 모델만 "본문 없음"이라 한 칸은 확정이 아니므로 기존 값을 지우지 않는다.
    if (outcome.kind === "empty" && !outcome.confirmed) continue;
    const { error: deleteError } = await admin.from("bulletin_scripture_readings").delete().eq("bulletin_id", bulletinId).eq("service_type", outcome.slot).neq("source", "manual");
    if (deleteError) throw new Error(deleteError.message);
    if (!outcome.refs.length) continue;
    const verified = outcome.kind === "verified";
    const rows = outcome.refs.map((ref, index) => ({
      bulletin_id: bulletinId,
      service_type: outcome.slot,
      book_id: ref.valid?.bookId ?? null,
      chapter_start: ref.valid?.chapterStart ?? null,
      verse_start: ref.valid?.verseStart ?? null,
      chapter_end: ref.valid?.chapterEnd ?? null,
      verse_end: ref.valid?.verseEnd ?? null,
      raw_reference: ref.raw,
      normalized_label: ref.valid?.normalizedLabel ?? null,
      source: "ai",
      confidence: verified ? 0.95 : 0.5,
      status: verified ? "verified" : "pending",
      sort_order: index,
      verified_at: verified ? now : null,
      verified_by: null,
      updated_at: now,
    }));
    const { error: insertError } = await admin.from("bulletin_scripture_readings").insert(rows);
    if (insertError) throw new Error(insertError.message);
  }
}

async function notifyStaff(admin: AdminClient, title: string, body: string, linkUrl: string, metadata: Record<string, unknown>) {
  const { data: staff } = await admin.from("profiles").select("id").in("role", ["admin", "office", "pastor"]).eq("status", "active");
  const rows = (staff || []).map((user: { id: string }) => ({
    user_id: user.id,
    type: "ops_bulletin_sync_error",
    title,
    body,
    link_url: linkUrl,
    metadata,
  }));
  if (rows.length) await admin.from("notifications").insert(rows);
}

type RunRecord = ExtractionRun & { bulletin_id: string; render_ms?: number | null; note?: string | null };
export type StoredRun = ExtractionRun & { bulletin_id: string | null; render_ms: number | null; note: string | null };

async function recordRun(admin: AdminClient, run: RunRecord) {
  // 기록 실패가 판독 결과를 망치지 않게 오류는 삼킨다.
  await admin.from("bulletin_scripture_extraction_runs").insert(run).then(() => undefined, () => undefined);
}

/** 최근 실행 기록과 자가 진단 결과. */
export async function loadScriptureHealth(admin: AdminClient): Promise<{ warnings: HealthWarning[]; runs: StoredRun[] }> {
  const { data } = await admin.from("bulletin_scripture_extraction_runs")
    .select("bulletin_id,trigger,started_at,duration_ms,budget_ms,render_ms,models,result_status,time_limited,note")
    .order("started_at", { ascending: false }).limit(30);
  const runs = (data || []) as StoredRun[];
  return { runs, warnings: assessScriptureHealth(runs, scriptureModels()) };
}

/** 설정을 바꿔야 하는 신호(action)는 종류별로 7일에 한 번만 관리자에게 알린다. */
async function notifyHealthChanges(admin: AdminClient) {
  const { warnings } = await loadScriptureHealth(admin);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  for (const warning of warnings.filter((item) => item.level === "action")) {
    const { data: recent } = await admin.from("notifications").select("id")
      .eq("type", "ops_bulletin_sync_error").contains("metadata", { event: "scripture_health", code: warning.code })
      .gte("created_at", since).limit(1);
    if (recent?.length) continue;
    await notifyStaff(admin, "주보 성경봉독 자동 판독 점검 필요", warning.message, "/admin/bulletin-scripture-readings", { event: "scripture_health", code: warning.code });
  }
}

export type ExtractionResult = { bulletinId: string; status: "retry" | "done" | "review" | "failed"; outcomes: SlotOutcome[]; errors: string[] };

/**
 * 주보 1건 추출. force=true 는 관리자가 화면에서 누른 재추출 — 시도 횟수와 무관하게 돌고 알림은 보내지 않는다.
 */
export async function runScriptureExtraction(admin: AdminClient, bulletinId: string, options: { deadline: number; force?: boolean }): Promise<ExtractionResult> {
  const startedAt = Date.now();
  const { data: bulletin, error } = await admin.from("bulletins").select("id,sunday_date,pdf_url").eq("id", bulletinId).maybeSingle();
  if (error || !bulletin?.pdf_url) throw new Error(error?.message || "주보 PDF 를 찾지 못했습니다.");
  const { data: state } = await admin.from("bulletin_scripture_extractions").select("attempts,notified_at").eq("bulletin_id", bulletinId).maybeSingle();
  const attempts = (state?.attempts ?? 0) + 1;

  let readings: ModelReading[] = [];
  let timeLimited = false;
  let renderMs: number | null = null;
  let failure: string | null = null;
  try {
    const file = await r2.from("bulletins").download(bulletin.pdf_url);
    if (file.error || !file.data) throw new Error("주보 PDF 를 내려받지 못했습니다.");
    const renderStartedAt = Date.now();
    const png = await renderBulletinFirstPage(new Uint8Array(await file.data.arrayBuffer()));
    renderMs = Date.now() - renderStartedAt;
    ({ readings, timeLimited } = await collectReadings(png, options.deadline));
  } catch (caught) {
    failure = caught instanceof Error ? caught.message : "주보 판독 준비 실패";
  }

  const succeeded = readings.filter((reading): reading is Extract<ModelReading, { ok: true }> => reading.ok);
  const errors = [failure, ...readings.map((reading) => (reading.ok ? null : `${reading.model}: ${reading.error}`))].filter((value): value is string => Boolean(value));
  const outcomes = await decideSlots(succeeded.slice(0, 2).map((reading) => reading.slots), makeValidator(admin));
  if (succeeded.length) await saveOutcomes(admin, bulletinId, outcomes);

  const canRetry = !options.force && attempts < MAX_SCRIPTURE_ATTEMPTS
    && (failure != null || readings.some((reading) => !reading.ok && reading.retryable));
  let status: ExtractionResult["status"];
  if (succeeded.length >= 2) status = outcomes.every((outcome) => outcome.confirmed) ? "done" : "review";
  else if (canRetry) status = "retry";
  else status = succeeded.length ? "review" : "failed";

  const shouldNotify = !options.force && (status === "review" || status === "failed") && !state?.notified_at;
  const { error: stateError } = await admin.from("bulletin_scripture_extractions").upsert({
    bulletin_id: bulletinId,
    status,
    attempts,
    model_results: Object.fromEntries(readings.map((reading) => [reading.model, reading.ok ? reading.slots : { error: reading.error }])),
    last_error: errors.join(" | ") || null,
    notified_at: shouldNotify ? new Date().toISOString() : state?.notified_at ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "bulletin_id" });
  if (stateError) throw new Error(stateError.message);

  if (shouldNotify) {
    const pending = outcomes.filter((outcome) => outcome.kind === "pending").length;
    const detail = status === "failed" ? "자동 판독에 실패했습니다. 직접 입력해 주세요." : `자동 판독 중 ${pending || "일부"}개 예배 본문이 확인을 기다립니다.`;
    await notifyStaff(admin, "주보 성경봉독 확인 필요", `${bulletin.sunday_date} 주보: ${detail}`, `/admin/bulletin-scripture-readings?bulletin_id=${bulletinId}`, { bulletin_id: bulletinId, event: "scripture_review" });
  }

  await recordRun(admin, {
    bulletin_id: bulletinId,
    trigger: options.force ? "manual" : "cron",
    started_at: new Date(startedAt).toISOString(),
    duration_ms: Date.now() - startedAt,
    budget_ms: Math.max(0, options.deadline - startedAt),
    render_ms: renderMs,
    models: readings.map((reading) => ({ model: reading.model, ok: reading.ok, ms: reading.ms, status: reading.status, ...(reading.ok ? {} : { error: reading.error.slice(0, 200) }) })),
    result_status: status,
    time_limited: timeLimited,
    note: failure,
  });
  await notifyHealthChanges(admin).catch(() => undefined);
  return { bulletinId, status, outcomes, errors };
}

/** 최근 7일 안의 명성교회 주보 중 아직 끝나지 않은 건을 처리한다(cron 전용). */
export async function processPendingScriptureExtractions(admin: AdminClient, options: { deadline: number }) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data: bulletins, error } = await admin.from("bulletins").select("id")
    .not("pdf_url", "is", null).ilike("content", "%UMS jubo no:%").gte("sunday_date", since)
    .order("sunday_date", { ascending: false }).limit(3);
  if (error) throw new Error(error.message);
  const ids = (bulletins || []).map((row: { id: string }) => row.id);
  if (!ids.length) return [];
  const { data: states } = await admin.from("bulletin_scripture_extractions").select("bulletin_id,status").in("bulletin_id", ids);
  const finished = new Set((states || []).filter((row: { status: string }) => row.status !== "retry").map((row: { bulletin_id: string }) => row.bulletin_id));
  const results: ExtractionResult[] = [];
  const pending = ids.filter((value: string) => !finished.has(value));
  for (const [index, id] of pending.entries()) {
    if (options.deadline - Date.now() < 20_000) {
      // 주보 수집 등으로 시간을 다 써서 판독을 시작도 못 한 경우 — "제한 시간을 늘려야 하는가" 의 핵심 신호.
      const leftMs = Math.max(0, options.deadline - Date.now());
      for (const deferredId of pending.slice(index)) {
        await recordRun(admin, { bulletin_id: deferredId, trigger: "cron", started_at: new Date().toISOString(), duration_ms: 0, budget_ms: leftMs, models: [], result_status: "deferred", time_limited: true, note: `남은 시간 ${Math.round(leftMs / 1000)}초로 판독을 다음 cron 으로 미룸` });
      }
      await notifyHealthChanges(admin).catch(() => undefined);
      break;
    }
    results.push(await runScriptureExtraction(admin, id, { deadline: options.deadline }));
  }
  return results;
}
