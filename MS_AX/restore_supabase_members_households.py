import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


BASE_DIR = r"C:\csh\project\chflow\MS_AX\chflow-project\db-backups\2026-05-11_pre_mdb_merge"
ENV_PATH = r"C:\csh\project\chflow\chflow-app\.env.local"
CHUNK_SIZE = 500


def load_env(path):
    env = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k] = v
    return env


ENV = load_env(ENV_PATH)
SUPABASE_URL = ENV["NEXT_PUBLIC_SUPABASE_URL"]
SERVICE_KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def http(method, path, body=None, headers=None):
    url = f"{SUPABASE_URL}/rest/v1{path}"
    data = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers={**HEADERS, **(headers or {})}, method=method)
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read()
        return json.loads(raw.decode("utf-8")) if raw else None


def load_json(name):
    path = os.path.join(BASE_DIR, f"{name}.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def chunked(rows, size):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def delete_all(table, where="id=not.is.null"):
    return http("DELETE", f"/{table}?{where}")


def insert_rows(table, rows):
    inserted = 0
    for batch in chunked(rows, CHUNK_SIZE):
        http("POST", f"/{table}", batch)
        inserted += len(batch)
        print(f"inserted {inserted}/{table}")


def main():
    households = load_json("households")
    members = load_json("members")

    print(f"restore households={len(households)} members={len(members)}")
    print("deleting members...")
    delete_all("members")
    print("deleting households...")
    delete_all("households")

    print("restoring households...")
    insert_rows("households", households)
    print("restoring members...")
    insert_rows("members", members)
    print("done")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {body}")
        sys.exit(1)
    except Exception as e:
        print(str(e))
        sys.exit(1)
