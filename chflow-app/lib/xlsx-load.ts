// exceljs 호환 xlsx 로더.
// 한컴오피스 한셀 등 일부 프로그램은 spreadsheetml XML에 네임스페이스 접두사(x:, ep: 등)를
// 붙여 저장하는데, exceljs는 무접두사 태그만 인식해 로드가 실패한다.
// → 1차 로드 실패 시 zip 내 XML의 접두사를 기본 네임스페이스로 정규화한 뒤 재시도.
import { Workbook } from "exceljs";
import JSZip from "jszip";

const NS_LIST = [
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://schemas.openxmlformats.org/package/2006/content-types",
];

function normalizeXml(xml: string): string {
  let out = xml;
  for (const ns of NS_LIST) {
    const declRe = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)="${ns.replace(/[/.]/g, "\\$&")}"`);
    const m = out.match(declRe);
    if (!m) continue;
    const prefix = m[1];
    if (prefix === "r") continue; // r:은 relationship 참조용 — exceljs가 접두사째 기대함
    out = out
      .replace(new RegExp(`<${prefix}:`, "g"), "<")
      .replace(new RegExp(`</${prefix}:`, "g"), "</")
      .replace(declRe, `xmlns="${ns}"`);
  }
  return out;
}

async function normalizeZip(bytes: Buffer | ArrayBuffer | Uint8Array): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes as never);
  const names = Object.keys(zip.files).filter((n) => /\.(xml|rels)$/i.test(n));
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry) continue;
    const text = await entry.async("string");
    const fixed = normalizeXml(text);
    if (fixed !== text) zip.file(name, fixed);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

// 파일 앞머리 서명으로 형식을 가른다.
//   xlsx/한셀 = ZIP(50 4B 03 04) · 구형 .xls = OLE2 복합문서(D0 CF 11 E0 A1 B1 1A E1)
// exceljs 는 xlsx 만 읽는다. 구형 .xls 를 그냥 null 로 흘리면 화면에서는 "계획서가 없다"
// 처럼 보여 원인을 못 찾는다. 그래서 형식을 따로 알려 준다.
export type WorkbookFormat = "xlsx" | "legacy-xls" | "unknown";

const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

export function detectWorkbookFormat(bytes: Buffer | ArrayBuffer | Uint8Array): WorkbookFormat {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  const startsWith = (sig: number[]) => sig.every((byte, index) => view[index] === byte);
  if (startsWith(ZIP_SIGNATURE)) return "xlsx";
  if (startsWith(OLE2_SIGNATURE)) return "legacy-xls";
  return "unknown";
}

/** 구형 .xls 를 올렸을 때 사람에게 보여줄 안내 */
export const LEGACY_XLS_NOTICE =
  "구형 엑셀(.xls) 파일이라 읽을 수 없습니다. 엑셀에서 [다른 이름으로 저장] → [Excel 통합 문서(*.xlsx)] 로 바꿔 다시 올려주세요.";

/** 왜 못 읽었는지까지 돌려주는 판 — 화면에 원인을 띄워야 할 때 쓴다 */
export async function loadWorkbookWithReason(
  bytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<{ workbook: Workbook | null; format: WorkbookFormat; reason: string | null }> {
  const format = detectWorkbookFormat(bytes);
  if (format === "legacy-xls") {
    return { workbook: null, format, reason: LEGACY_XLS_NOTICE };
  }
  const workbook = await loadWorkbook(bytes);
  return {
    workbook,
    format,
    reason: workbook ? null : "엑셀 파일을 열 수 없습니다. 파일이 손상되었는지 확인해주세요.",
  };
}

// 로드 성공 시 Workbook, 파일이 깨졌거나 지원 불가 형식이면 null.
export async function loadWorkbook(bytes: Buffer | ArrayBuffer | Uint8Array): Promise<Workbook | null> {
  const load = async (data: Buffer | ArrayBuffer | Uint8Array) => {
    const wb = new Workbook();
    const loadFn = wb.xlsx.load.bind(wb.xlsx) as (d: unknown) => Promise<unknown>;
    await loadFn(data);
    return wb;
  };
  try {
    return await load(bytes);
  } catch {
    // 접두사 정규화 후 재시도 (한셀 등)
  }
  try {
    return await load(await normalizeZip(bytes));
  } catch {
    return null;
  }
}
