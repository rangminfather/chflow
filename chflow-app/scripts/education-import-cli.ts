import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { matchMemberByIdentity, type IdentityAlias, type MatchableMember } from "../lib/education/matching";
import { parseEducationHwpx } from "../lib/education/parser";
import type { EducationParseResult, EducationSourceType } from "../lib/education/types";

type HwpxSourceType = Extract<EducationSourceType, "general_education_history" | "lmtc_history">;

interface ImportOptions {
  file: string;
  sourceType: HwpxSourceType;
  dryRun: boolean;
  outputDir: string;
  envFile: string | null;
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function mapSourceType(value: string | null, fallback?: HwpxSourceType): HwpxSourceType {
  if (!value && fallback) return fallback;
  if (value === "general" || value === "general_education_history") return "general_education_history";
  if (value === "lmtc" || value === "lmtc_history") return "lmtc_history";
  throw new Error("--type은 general 또는 lmtc여야 합니다.");
}

function parseOptions(fallback?: HwpxSourceType): ImportOptions {
  const file = readArg("file");
  if (!file) throw new Error('--file="원본.hwpx"를 지정해야 합니다.');
  return {
    file: path.resolve(file),
    sourceType: mapSourceType(readArg("type"), fallback),
    dryRun: hasFlag("dry-run"),
    outputDir: path.resolve(readArg("output") ?? "private/import/education-history/output"),
    envFile: readArg("env-file") ? path.resolve(readArg("env-file")!) : null,
  };
}

async function loadEnvFile(filePath: string | null): Promise<void> {
  if (!filePath) return;
  const body = await readFile(filePath, "utf8");
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function fileSha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function detectPreviewDuplicates(result: EducationParseResult): number {
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const row of result.rows) {
    if (!row.person_name_normalized || !row.normalized_data.standard_course_name) continue;
    const key = [
      row.person_name_normalized,
      row.normalized_data.standard_course_name,
      row.cohort_no ?? row.cohort_label_raw ?? "",
      row.completed_on ?? `${row.started_on ?? ""}:${row.ended_on ?? ""}`,
      row.attendance_status,
      row.class_variant ?? "",
      row.organization_raw ?? "",
    ].join("|");
    if (seen.has(key)) duplicateCount += 1;
    else seen.add(key);
  }
  return duplicateCount;
}

async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

async function enrichMatchingStats(result: EducationParseResult): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    result.report.warnings.push(
      "Supabase 서비스 환경변수가 없어 성도 후보 통계는 계산하지 않았습니다.",
    );
    return;
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const members = await fetchAll<MatchableMember>((from, to) =>
    admin.from("members").select("id,name,sub_role").eq("status", "active").range(from, to),
  );
  let aliases: IdentityAlias[] = [];
  try {
    aliases = await fetchAll<IdentityAlias>((from, to) =>
      admin
        .from("member_identity_aliases")
        .select("id,member_id,person_name_normalized,active")
        .eq("active", true)
        .range(from, to),
    );
  } catch {
    result.report.warnings.push(
      "별칭 테이블이 아직 적용되지 않아 현재 성도 이름만으로 후보를 계산했습니다.",
    );
  }
  let recommended = 0;
  let ambiguous = 0;
  let unmatched = 0;
  for (const row of result.rows) {
    const match = matchMemberByIdentity(row.person_name_normalized, members, aliases);
    if (match.status === "recommended") recommended += 1;
    else if (match.status === "ambiguous") ambiguous += 1;
    else unmatched += 1;
  }
  result.report.singleMemberCandidates = recommended;
  result.report.ambiguousMemberCandidates = ambiguous;
  result.report.unmatchedMemberCandidates = unmatched;
}

async function writePreview(
  options: ImportOptions,
  result: EducationParseResult,
  hash: string,
): Promise<{ previewPath: string; reportPath: string }> {
  await mkdir(options.outputDir, { recursive: true });
  const prefix = options.sourceType === "lmtc_history" ? "lmtc" : "general-education";
  const previewPath = path.join(options.outputDir, `${prefix}-preview.json`);
  const reportPath = path.join(options.outputDir, `${prefix}-validation-report.json`);
  await writeFile(
    previewPath,
    `${JSON.stringify({
      sourceFilename: path.basename(options.file),
      sourceType: options.sourceType,
      fileHash: hash,
      parserVersion: result.parserVersion,
      rows: result.rows,
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(reportPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  return { previewPath, reportPath };
}

async function stageImport(
  options: ImportOptions,
  result: EducationParseResult,
  hash: string,
): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const accessToken = process.env.EDUCATION_IMPORT_ACCESS_TOKEN;
  if (!url || !anonKey || !accessToken) {
    throw new Error(
      "실제 적재에는 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, "
      + "EDUCATION_IMPORT_ACCESS_TOKEN이 필요합니다.",
    );
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await client.rpc("stage_education_import", {
    p_batch: {
      source_filename: path.basename(options.file),
      source_type: options.sourceType,
      file_hash: hash,
      parser_version: result.parserVersion,
      total_tables: result.report.totalTables,
      total_rows: result.report.totalExtractedRows,
      valid_rows: result.report.validDataRows,
      invalid_rows: result.report.invalidDataRows,
      repeated_header_rows: result.report.repeatedHeaderRows,
      empty_rows: result.report.emptyRows,
      validation_report: result.report,
    },
    p_rows: result.rows,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function runEducationImport(fallback?: HwpxSourceType): Promise<void> {
  const options = parseOptions(fallback);
  await loadEnvFile(options.envFile);
  const [result, hash] = await Promise.all([
    parseEducationHwpx(options.file, options.sourceType),
    fileSha256(options.file),
  ]);
  result.report.duplicateSuspected = detectPreviewDuplicates(result);
  await enrichMatchingStats(result);
  const output = await writePreview(options, result, hash);

  console.log(JSON.stringify({
    mode: options.dryRun ? "dry-run" : "stage",
    sourceFile: options.file,
    fileHash: hash,
    previewPath: output.previewPath,
    reportPath: output.reportPath,
    report: result.report,
  }, null, 2));

  if (!options.dryRun) {
    const batchId = await stageImport(options, result, hash);
    console.log(`임시 가져오기 배치 생성 완료: ${batchId}`);
  }
}
