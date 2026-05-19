import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import fitz


ROOT = Path(r"C:\csh\project\chflow")
ENV_FILE = ROOT / "chflow-app" / ".env.local"
DATA_DIR = ROOT / "\uc790\ub8cc"
ORIGINAL_PDF_SIZE = 36979781
OCR_PDF_SIZE = 21290379
OUTPUT_DIR = ROOT / "MS_AX" / "generated" / "directory_photo_crops_v2"
BUCKET = "member-photos"
PREFIX = "directory-crops-v2"
PHOTO_PAGE_LIMIT = 43
LABEL_OVERRIDES = {
    "p006_photo11.png": {"pdf_name": "\uc815\uc21c\uae38"},
    "p011_photo14.png": {"pdf_name": "\ucd5c\uc131\ud5cc"},
}


def load_env() -> None:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)


def request_json(url: str, headers: dict[str, str], data: object | None = None, method: str = "GET"):
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as res:
        raw = res.read()
    return json.loads(raw.decode("utf-8")) if raw else None


def normalize_phone(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def normalize_name(value: str | None) -> str:
    text = re.sub(r"[^\uac00-\ud7a3]", "", value or "")
    return (
        text.replace("\uc751", "\uc6c5")
        .replace("\uc625", "\uc6b1")
        .replace("\ubc95", "\ubc94")
        .replace("\ud734", "\ud765")
    )


def find_pdf_by_size(size: int) -> Path:
    matches = [p for p in DATA_DIR.glob("*.pdf") if p.stat().st_size == size]
    if not matches:
        raise FileNotFoundError(f"PDF not found by size: {size}")
    return matches[0]


def rect_tuple(rect: fitz.Rect) -> tuple[float, float, float, float]:
    return (float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1))


def intersects_ratio(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter == 0:
        return 0.0
    area_a = (ax1 - ax0) * (ay1 - ay0)
    area_b = (bx1 - bx0) * (by1 - by0)
    return inter / min(area_a, area_b)


def row_major(items: list[dict]) -> list[dict]:
    rows: list[dict] = []
    for item in sorted(items, key=lambda x: (((x["bbox"][1] + x["bbox"][3]) / 2), x["bbox"][0])):
        cy = (item["bbox"][1] + item["bbox"][3]) / 2
        for row in rows:
            if abs(row["cy"] - cy) < 20:
                row["items"].append(item)
                row["cy"] = (row["cy"] * (len(row["items"]) - 1) + cy) / len(row["items"])
                break
        else:
            rows.append({"cy": cy, "items": [item]})

    out: list[dict] = []
    for row in sorted(rows, key=lambda r: r["cy"]):
        out.extend(sorted(row["items"], key=lambda x: x["bbox"][0]))
    return out


def dedupe_candidates(items: list[dict]) -> list[dict]:
    kept: list[dict] = []
    for item in sorted(items, key=lambda x: ((x["bbox"][1] + x["bbox"][3]) / 2, x["bbox"][0])):
        duplicate_index = None
        for index, current in enumerate(kept):
            if intersects_ratio(item["bbox"], current["bbox"]) >= 0.85:
                duplicate_index = index
                break
        if duplicate_index is None:
            kept.append(item)
            continue

        current = kept[duplicate_index]
        item_area = item["display_width"] * item["display_height"]
        current_area = current["display_width"] * current["display_height"]
        item_source_area = item["source_width"] * item["source_height"]
        current_source_area = current["source_width"] * current["source_height"]
        if (item_area, item_source_area) > (current_area, current_source_area):
            kept[duplicate_index] = item

    return row_major(kept)


def get_photo_candidates(page: fitz.Page) -> list[dict]:
    candidates: list[dict] = []
    for info in page.get_image_info(xrefs=True):
        bbox = rect_tuple(fitz.Rect(info["bbox"]))
        x0, y0, x1, y1 = bbox
        display_width = x1 - x0
        display_height = y1 - y0
        ratio = display_width / display_height if display_height else 0
        source_width = int(info.get("width") or 0)
        source_height = int(info.get("height") or 0)

        if not (45 <= display_width <= 96):
            continue
        if not (55 <= display_height <= 108):
            continue
        if not (0.72 <= ratio <= 1.18):
            continue
        if y0 < 120 or y1 > 720:
            continue
        if source_width < 80 or source_height < 80:
            continue

        candidates.append(
            {
                "bbox": bbox,
                "display_width": display_width,
                "display_height": display_height,
                "source_width": source_width,
                "source_height": source_height,
            }
        )
    return dedupe_candidates(candidates)


def ocr_lines(page: fitz.Page) -> list[dict]:
    lines: list[dict] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line.get("spans", [])).strip()
            if not text:
                continue
            lines.append({"text": text, "bbox": tuple(float(v) for v in line["bbox"])})
    return lines


def line_near_photo(line: dict, bbox: tuple[float, float, float, float]) -> bool:
    x0, _, x1, y1 = bbox
    lx0, ly0, lx1, _ = line["bbox"]
    line_center = (lx0 + lx1) / 2
    return y1 - 3 <= ly0 <= y1 + 42 and x0 - 16 <= line_center <= x1 + 16


def extract_name_from_text(text: str) -> str | None:
    match = re.match(r"^([\uac00-\ud7a3]{2,8})", text)
    if not match:
        return None

    name = match.group(1)
    suffixes = [
        "\ub2f4\uc784\ubaa9\uc0ac",
        "\uc804\ub3c4\uc0ac",
        "\uac15\ub3c4\uc0ac",
        "\uc120\uad50\uc0ac",
        "\ubaa9\uc0ac",
        "\ubaa9\uc790",
        "\ubaa9\ub140",
        "\uc0ac\ubaa8",
        "\uc7a5\ub85c",
        "\uad8c\uc0ac",
        "\uc9d1\uc0ac",
        "\uc131\ub3c4",
        "\ucd1d\ubb34",
        "\ub2f4\uc784",
    ]
    changed = True
    while changed:
        changed = False
        for suffix in suffixes:
            if name.endswith(suffix) and len(name) > len(suffix) + 1:
                name = name[: -len(suffix)]
                changed = True
    return name if 2 <= len(name) <= 4 else None


def extract_label(lines: list[dict], bbox: tuple[float, float, float, float]) -> tuple[str | None, str | None]:
    nearby = [line for line in lines if line_near_photo(line, bbox)]
    nearby.sort(key=lambda line: (line["bbox"][1], line["bbox"][0]))

    name = None
    phones: list[str] = []
    for line in nearby:
        text = re.sub(r"\s+", "", line["text"])
        if name is None:
            name = extract_name_from_text(text)
        for match in re.finditer(r"(010[-\s]?\d{3,4}[-\s]?\d{4}|\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})", text):
            phones.append(normalize_phone(match.group(1)))

    mobile = next((phone for phone in phones if phone.startswith("010") and len(phone) in (10, 11)), None)
    return name, mobile or (phones[0] if phones else None)


def render_crop(page: fitz.Page, bbox: tuple[float, float, float, float], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    clip = fitz.Rect(bbox)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(6, 6), clip=clip, alpha=False)
    pixmap.save(output_path)


def build_rows(original_pdf: Path, ocr_pdf: Path) -> list[dict]:
    original_doc = fitz.open(original_pdf)
    ocr_doc = fitz.open(ocr_pdf)
    page_count = min(PHOTO_PAGE_LIMIT, len(original_doc), len(ocr_doc))
    rows: list[dict] = []

    for page_idx in range(page_count):
        photo_page = page_idx + 1
        original_page = original_doc[page_idx]
        lines = ocr_lines(ocr_doc[page_idx])
        candidates = get_photo_candidates(original_page)

        for photo_index, candidate in enumerate(candidates):
            source_file = f"p{photo_page:03d}_photo{photo_index:02d}.png"
            name, phone = extract_label(lines, candidate["bbox"])
            override = LABEL_OVERRIDES.get(source_file, {})
            name = override.get("pdf_name", name)
            phone = override.get("pdf_phone", phone)
            render_crop(original_page, candidate["bbox"], OUTPUT_DIR / source_file)
            rows.append(
                {
                    "source_file": source_file,
                    "photo_page": photo_page,
                    "photo_index": photo_index,
                    "pdf_name": name,
                    "pdf_phone": phone,
                }
            )

        print(f"page {photo_page:03d}: crops={len(candidates)}", flush=True)

    return rows


def get_members(url: str, headers: dict[str, str]) -> list[dict]:
    out = []
    offset = 0
    limit = 1000
    select = "id,name,phone,status,is_child"
    while True:
        path = f"/rest/v1/members?select={select}&offset={offset}&limit={limit}"
        endpoint = url + urllib.parse.quote(path, safe="/?:=&*,.-_")
        chunk = request_json(endpoint, headers)
        out.extend(chunk)
        if len(chunk) < limit:
            return out
        offset += limit


def attach_expected_members(rows: list[dict], members: list[dict]) -> list[dict]:
    by_phone: dict[str, list[dict]] = defaultdict(list)
    by_name: dict[str, list[dict]] = defaultdict(list)

    for member in members:
        if member.get("status") != "active" or member.get("is_child"):
            continue
        phone = normalize_phone(member.get("phone"))
        if phone:
            by_phone[phone].append(member)
        name = normalize_name(member.get("name"))
        if name:
            by_name[name].append(member)

    for row in rows:
        candidates = []
        phone = normalize_phone(row.get("pdf_phone"))
        if phone:
            candidates = by_phone.get(phone, [])
        if not candidates and row.get("pdf_name"):
            candidates = by_name.get(normalize_name(row["pdf_name"]), [])
        row["expected_member_id"] = candidates[0]["id"] if len(candidates) == 1 else None
    return rows


def upload_file(url: str, headers: dict[str, str], source_file: str) -> str:
    path = f"{PREFIX}/{source_file}"
    file_path = OUTPUT_DIR / source_file
    data = file_path.read_bytes()
    object_url = f"{url}/storage/v1/object/{BUCKET}/{urllib.parse.quote(path, safe='/')}"
    upload_headers = {
        **headers,
        "Content-Type": "image/png",
        "x-upsert": "true",
    }
    req = urllib.request.Request(object_url, data=data, method="POST", headers=upload_headers)
    try:
        urllib.request.urlopen(req, timeout=90).read()
    except urllib.error.HTTPError:
        req = urllib.request.Request(object_url, data=data, method="PUT", headers=upload_headers)
        urllib.request.urlopen(req, timeout=90).read()
    return f"{url}/storage/v1/object/public/{BUCKET}/{path}"


def delete_existing_rows(url: str, headers: dict[str, str]) -> None:
    endpoint = f"{url}/rest/v1/directory_photo_crops?source_file=neq.__never__"
    delete_headers = {**headers, "Prefer": "return=minimal"}
    request_json(endpoint, delete_headers, method="DELETE")


def insert_rows(url: str, headers: dict[str, str], rows: list[dict]) -> None:
    endpoint = f"{url}/rest/v1/directory_photo_crops"
    insert_headers = {
        **headers,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    batch_size = 100
    for start in range(0, len(rows), batch_size):
        request_json(endpoint, insert_headers, rows[start : start + batch_size], method="POST")
        print(f"inserted {min(start + batch_size, len(rows))}/{len(rows)}", flush=True)


def main() -> int:
    load_env()
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    original_pdf = find_pdf_by_size(ORIGINAL_PDF_SIZE)
    ocr_pdf = find_pdf_by_size(OCR_PDF_SIZE)
    print(f"original_pdf={original_pdf}", flush=True)
    print(f"ocr_pdf={ocr_pdf}", flush=True)

    rows = build_rows(original_pdf, ocr_pdf)
    members = get_members(url, headers)
    rows = attach_expected_members(rows, members)

    for index, row in enumerate(rows, 1):
        row["source_url"] = upload_file(url, headers, row["source_file"])
        if index % 50 == 0:
            print(f"uploaded {index}/{len(rows)}", flush=True)

    delete_existing_rows(url, headers)
    insert_rows(url, headers, rows)

    mapped = sum(1 for row in rows if row.get("expected_member_id"))
    named = sum(1 for row in rows if row.get("pdf_name"))
    digest = hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    print(
        f"done rows={len(rows)} named={named} expected_member_mapped={mapped} sha256={digest}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
