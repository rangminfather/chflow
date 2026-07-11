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
