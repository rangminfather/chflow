import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import fitz


ROOT = Path(r"C:\csh\project\chflow")
ENV_FILE = ROOT / "chflow-app" / ".env.local"
PHOTOS_DIR = (
    ROOT
    / "MS_AX"
    / "archive"
    / "2026-05-18_cleanup_candidates"
    / "extraction_outputs"
    / "parsed-data"
    / "photos"
)
BUCKET = "member-photos"
PREFIX = "directory-crops"


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
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
    return json.loads(raw.decode("utf-8")) if raw else None


def normalize_phone(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def normalize_name(value: str | None) -> str:
    text = re.sub(r"[^\uac00-\ud7a3]", "", value or "")
    # OCR confusions seen in the directory photo pages.
    return (
        text.replace("\uc751", "\uc6c5")
        .replace("\uc625", "\uc6b1")
        .replace("\ubc95", "\ubc94")
        .replace("\ud734", "\ud765")
    )


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


def find_ocr_pdf() -> Path:
    matches = [
        p
        for p in ROOT.glob("**/*.pdf")
        if "ocr" in p.name.lower() and p.stat().st_size == 21290379 and "test-excel" not in str(p)
    ]
    if not matches:
        raise FileNotFoundError("OCR text-layer PDF not found")
    return matches[0]


def parse_photo_rows(pdf_path: Path) -> list[dict]:
    doc = fitz.open(pdf_path)
    rows: list[dict] = []

    for page_idx in range(min(43, len(doc))):
        page = doc[page_idx]
        photo_page = page_idx + 1
        image_infos = {info["xref"]: info["bbox"] for info in page.get_image_info(xrefs=True)}

        images = []
        for img in page.get_images(full=True):
            xref, width, height = img[0], img[2], img[3]
            bbox = image_infos.get(xref)
            if bbox and 400 < width < 800 and 400 < height < 800:
                images.append({"bbox": bbox})
        images = row_major(images)

        spans = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span["text"].strip()
                    if text:
                        spans.append({"text": text, "bbox": span["bbox"]})

        for photo_index, image in enumerate(images):
            x0, _, x1, y1 = image["bbox"]
            nearby = [
                s
                for s in spans
                if x0 - 15 <= s["bbox"][0] <= x1 + 15 and y1 - 2 <= s["bbox"][1] <= y1 + 75
            ]
            nearby = sorted(nearby, key=lambda s: (s["bbox"][1], s["bbox"][0]))

            name = None
            phone = None
            for span in nearby:
                match = re.match(r"^\s*([\uac00-\ud7a3]{2,4})\s*(?:\(|$)", span["text"])
                if match and span["bbox"][1] <= y1 + 28:
                    name = match.group(1)
                    break
            for span in nearby:
                match = re.search(r"010[-\s]?(\d{3,4})[-\s]?(\d{4})", span["text"].replace(" ", ""))
                if match:
                    phone = "010" + match.group(1) + match.group(2)
                    break

            source_file = f"p{photo_page:03d}_photo{photo_index:02d}.png"
            if (PHOTOS_DIR / source_file).exists():
                rows.append(
                    {
                        "source_file": source_file,
                        "photo_page": photo_page,
                        "photo_index": photo_index,
                        "pdf_name": name,
                        "pdf_phone": phone,
                    }
                )

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
        if row.get("pdf_phone"):
            candidates = by_phone.get(row["pdf_phone"], [])
        if not candidates and row.get("pdf_name"):
            candidates = by_name.get(normalize_name(row["pdf_name"]), [])
        row["expected_member_id"] = candidates[0]["id"] if len(candidates) == 1 else None
    return rows


def upload_file(url: str, headers: dict[str, str], source_file: str) -> str:
    path = f"{PREFIX}/{source_file}"
    file_path = PHOTOS_DIR / source_file
    data = file_path.read_bytes()
    object_url = f"{url}/storage/v1/object/{BUCKET}/{urllib.parse.quote(path, safe='/')}"
    upload_headers = {
        **headers,
        "Content-Type": "image/png",
        "x-upsert": "true",
    }
    req = urllib.request.Request(object_url, data=data, method="POST", headers=upload_headers)
    try:
        urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError:
        req = urllib.request.Request(object_url, data=data, method="PUT", headers=upload_headers)
        urllib.request.urlopen(req, timeout=60).read()
    return f"{url}/storage/v1/object/public/{BUCKET}/{path}"


def upsert_rows(url: str, headers: dict[str, str], rows: list[dict]) -> None:
    endpoint = f"{url}/rest/v1/directory_photo_crops?on_conflict=source_file"
    upsert_headers = {
        **headers,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    batch_size = 100
    for start in range(0, len(rows), batch_size):
        request_json(endpoint, upsert_headers, rows[start : start + batch_size], method="POST")
        print(f"upserted {min(start + batch_size, len(rows))}/{len(rows)}", flush=True)


def main() -> int:
    load_env()
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    pdf_path = find_ocr_pdf()
    print(f"ocr_pdf={pdf_path}", flush=True)
    rows = parse_photo_rows(pdf_path)
    members = get_members(url, headers)
    rows = attach_expected_members(rows, members)

    for index, row in enumerate(rows, 1):
        row["source_url"] = upload_file(url, headers, row["source_file"])
        if index % 50 == 0:
            print(f"uploaded {index}/{len(rows)}", flush=True)

    upsert_rows(url, headers, rows)
    mapped = sum(1 for row in rows if row.get("expected_member_id"))
    digest = hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    print(f"done rows={len(rows)} expected_member_mapped={mapped} sha256={digest}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
