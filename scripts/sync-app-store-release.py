#!/usr/bin/env python3
"""Sync the version actually visible in the KR App Store to Vercel."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


APP_STORE_ID = "6795782758"
BUNDLE_ID = "com.smartmyungsung.app"
STOREFRONT = "kr"
APP_STORE_LOOKUP_URL = (
    f"https://itunes.apple.com/lookup?id={APP_STORE_ID}&country={STOREFRONT}"
)
VERCEL_API_ROOT = "https://api.vercel.com"
APP_CONFIG_URL = "https://smartms.kr/api/app-config"
VERSION_PATTERN = re.compile(r"^\d+(?:\.\d+){1,3}$")
RETRYABLE_HTTP_CODES = {408, 429, 500, 502, 503, 504}


class SyncError(RuntimeError):
    pass


@dataclass
class SyncOutcome:
    detected_version: str | None = None
    previous_server_version: str | None = None
    previous_vercel_version: str | None = None
    changed: bool = False
    deploy_hook_called: bool = False
    verified: bool = False
    action: str = "not started"


def parse_version(value: Any) -> tuple[int, ...] | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    if not VERSION_PATTERN.fullmatch(stripped):
        return None
    return tuple(int(part) for part in stripped.split("."))


def versions_equal(left: str, right: str) -> bool:
    left_parts = parse_version(left)
    right_parts = parse_version(right)
    if left_parts is None or right_parts is None:
        return False
    length = max(len(left_parts), len(right_parts))
    return left_parts + (0,) * (length - len(left_parts)) == right_parts + (0,) * (
        length - len(right_parts)
    )


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    label: str,
    attempts: int = 3,
    timeout: int = 30,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    request_headers = {"Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    for attempt in range(1, attempts + 1):
        request = Request(url, data=data, headers=request_headers, method=method)
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
            if not raw.strip():
                return {}
            decoded = json.loads(raw)
            if not isinstance(decoded, dict):
                raise SyncError(f"{label} returned an unexpected JSON value")
            return decoded
        except HTTPError as error:
            if error.code not in RETRYABLE_HTTP_CODES or attempt == attempts:
                raise SyncError(f"{label} returned HTTP {error.code}") from error
        except (URLError, TimeoutError) as error:
            if attempt == attempts:
                reason = getattr(error, "reason", "request timed out")
                raise SyncError(f"{label} failed: {reason}") from error
        except json.JSONDecodeError as error:
            raise SyncError(f"{label} returned invalid JSON") from error
        sleep(min(2 ** (attempt - 1), 4))
    raise SyncError(f"{label} failed")


def read_app_store_version() -> str:
    response = request_json(APP_STORE_LOOKUP_URL, label="KR App Store lookup")
    results = response.get("results")
    if response.get("resultCount") != 1 or not isinstance(results, list) or len(results) != 1:
        raise SyncError("KR App Store lookup did not return exactly one app")
    app = results[0]
    if not isinstance(app, dict) or app.get("bundleId") != BUNDLE_ID:
        observed = app.get("bundleId") if isinstance(app, dict) else None
        raise SyncError(f"App Store Bundle ID mismatch: expected {BUNDLE_ID}, observed {observed!r}")
    version = app.get("version")
    if parse_version(version) is None:
        raise SyncError(f"App Store returned an invalid semantic version: {version!r}")
    return version.strip()


def vercel_headers() -> dict[str, str]:
    token = os.environ.get("VERCEL_TOKEN", "")
    if not token:
        raise SyncError("VERCEL_TOKEN is not configured")
    return {"Authorization": f"Bearer {token}"}


def vercel_project_id() -> str:
    project_id = os.environ.get("VERCEL_PROJECT_ID", "")
    if not project_id:
        raise SyncError("VERCEL_PROJECT_ID is not configured")
    return project_id


def vercel_url(path: str) -> str:
    vercel_project_id()
    team_id = os.environ.get("VERCEL_TEAM_ID", "")
    query = urlencode({"teamId": team_id}) if team_id else ""
    return f"{VERCEL_API_ROOT}{path}?{query}" if query else f"{VERCEL_API_ROOT}{path}"


def read_vercel_latest() -> tuple[str, str]:
    project_id = vercel_project_id()
    response = request_json(
        vercel_url(f"/v9/projects/{project_id}/env"),
        headers=vercel_headers(),
        label="Vercel environment list",
    )
    candidates = [
        entry
        for entry in response.get("envs", [])
        if entry.get("key") == "LATEST_IOS_VERSION"
        and "production" in (entry.get("target") or [])
    ]
    if len(candidates) != 1:
        raise SyncError(
            "expected exactly one production LATEST_IOS_VERSION variable in Vercel"
        )
    env_id = candidates[0].get("id")
    if not isinstance(env_id, str) or not env_id:
        raise SyncError("Vercel LATEST_IOS_VERSION has no environment-variable id")
    detail = request_json(
        vercel_url(f"/v9/projects/{project_id}/env/{env_id}"),
        headers=vercel_headers(),
        label="Vercel LATEST_IOS_VERSION detail",
    )
    value = detail.get("value")
    if parse_version(value) is None:
        raise SyncError("Vercel LATEST_IOS_VERSION is not a valid semantic version")
    return value.strip(), env_id


def update_vercel_latest(env_id: str, version: str) -> None:
    project_id = vercel_project_id()
    request_json(
        vercel_url(f"/v9/projects/{project_id}/env/{env_id}"),
        method="PATCH",
        headers=vercel_headers(),
        body={"value": version, "target": ["production"]},
        label="Vercel LATEST_IOS_VERSION update",
    )


def call_deploy_hook() -> None:
    hook_url = os.environ.get("VERCEL_DEPLOY_HOOK_URL", "")
    if not hook_url:
        raise SyncError("VERCEL_DEPLOY_HOOK_URL is not configured")
    request_json(
        hook_url,
        method="POST",
        body={},
        label="Vercel Deploy Hook",
    )


def read_public_latest(*, attempts: int = 3) -> str | None:
    response = request_json(
        f"{APP_CONFIG_URL}?t={int(time.time())}",
        headers={"Cache-Control": "no-cache"},
        label="public app config",
        attempts=attempts,
    )
    value = response.get("latest_ios_version")
    return value.strip() if parse_version(value) is not None else None


def verify_redeployment(
    expected: str,
    *,
    attempts: int = 30,
    interval: float = 10,
    read_latest: Callable[[], str | None] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    observed = None
    reader = read_latest or (lambda: read_public_latest(attempts=1))
    for _ in range(attempts):
        try:
            observed = reader()
        except SyncError:
            observed = None
        if observed is not None and versions_equal(observed, expected):
            print(f"Verified public app config: latest_ios_version={observed}")
            return
        print(f"Waiting for Vercel deployment: expected={expected}, observed={observed}")
        sleep(interval)
    raise SyncError(
        f"public app config did not expose latest_ios_version={expected} within the retry window"
    )


def write_summary(outcome: SyncOutcome, error: str | None = None) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    lines = [
        "### iOS App Store/Vercel sync",
        "",
        f"- Detected KR App Store version: `{outcome.detected_version or 'not read'}`",
        f"- Previous public server version: `{outcome.previous_server_version or 'not read'}`",
        f"- Previous Vercel LATEST_IOS_VERSION: `{outcome.previous_vercel_version or 'not read'}`",
        f"- LATEST_IOS_VERSION changed: `{'yes' if outcome.changed else 'no'}`",
        f"- Deploy Hook called: `{'yes' if outcome.deploy_hook_called else 'no'}`",
        f"- Public API verified: `{'yes' if outcome.verified else 'no'}`",
        f"- Action: {outcome.action}",
    ]
    if error:
        lines.append(f"- Error: {error}")
    lines.append("")
    with open(summary_path, "a", encoding="utf-8") as summary:
        summary.write("\n".join(lines))


def sync_release(
    *, dry_run: bool = False, outcome: SyncOutcome | None = None
) -> SyncOutcome:
    outcome = outcome or SyncOutcome()
    outcome.detected_version = read_app_store_version()
    outcome.previous_server_version = read_public_latest()
    if outcome.previous_server_version is None:
        raise SyncError(
            "public app config has no valid latest_ios_version; refusing to change Vercel"
        )
    if dry_run:
        outcome.verified = versions_equal(
            outcome.previous_server_version, outcome.detected_version
        )
        outcome.action = "dry-run; no Vercel changes or deployment"
        return outcome

    current_version, env_id = read_vercel_latest()
    outcome.previous_vercel_version = current_version
    if not versions_equal(current_version, outcome.detected_version):
        update_vercel_latest(env_id, outcome.detected_version)
        outcome.changed = True
        print(
            "Updated Vercel LATEST_IOS_VERSION "
            f"from {current_version} to {outcome.detected_version}."
        )

    if versions_equal(outcome.previous_server_version, outcome.detected_version):
        outcome.verified = True
        outcome.action = (
            "updated environment; public API was already current"
            if outcome.changed
            else "no-op; Vercel and public API are already current"
        )
        print(f"No deployment needed: latest_ios_version={outcome.detected_version}.")
        return outcome

    call_deploy_hook()
    outcome.deploy_hook_called = True
    verify_redeployment(outcome.detected_version)
    outcome.verified = True
    outcome.action = "updated environment if needed; redeployed and verified"
    return outcome


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="read the App Store and public config without changing Vercel",
    )
    args = parser.parse_args(argv)
    outcome = SyncOutcome()
    try:
        outcome = sync_release(dry_run=args.dry_run, outcome=outcome)
    except SyncError as error:
        outcome.action = "failed"
        write_summary(outcome, str(error))
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    write_summary(outcome)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
