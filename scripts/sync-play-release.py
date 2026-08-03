#!/usr/bin/env python3
"""Sync a fully released Google Play version to Vercel.

The Play API edit is deliberately read-only: it is inserted only to read the
production track and is always deleted. This script never calls edits.commit.
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account


PACKAGE_NAME = "com.smartmyungsung.app"
PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
PLAY_API_ROOT = "https://androidpublisher.googleapis.com/androidpublisher/v3"
VERCEL_API_ROOT = "https://api.vercel.com"
APP_CONFIG_URL = "https://smartms.kr/api/app-config"


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request_headers = {"Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    request = Request(url, data=data, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        fail(f"{method} {url} returned HTTP {error.code}: {detail[:500]}")
    except URLError as error:
        fail(f"{method} {url} failed: {error.reason}")
    if not raw.strip():
        return {}
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"{method} {url} returned invalid JSON: {error}")
    if not isinstance(decoded, dict):
        fail(f"{method} {url} returned an unexpected JSON value")
    return decoded


def play_access_token() -> str:
    raw = os.environ.get("PLAY_SERVICE_ACCOUNT_JSON", "")
    if not raw:
        fail("PLAY_SERVICE_ACCOUNT_JSON is not configured")
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"PLAY_SERVICE_ACCOUNT_JSON is not valid JSON: {error}")
    if not isinstance(info, dict):
        fail("PLAY_SERVICE_ACCOUNT_JSON must contain a service-account object")
    try:
        credentials = service_account.Credentials.from_service_account_info(
            info,
            scopes=[PLAY_SCOPE],
        )
        credentials.refresh(GoogleAuthRequest())
    except Exception as error:  # google-auth exposes several exception types
        fail(f"could not authenticate the Play read-only service account: {error}")
    if not credentials.token:
        fail("Google authentication returned no access token")
    return credentials.token


def read_play_production_version(token: str) -> int | None:
    auth_headers = {"Authorization": f"Bearer {token}"}
    edit_url = f"{PLAY_API_ROOT}/applications/{PACKAGE_NAME}/edits"
    edit = request_json(edit_url, method="POST", headers=auth_headers, body={})
    edit_id = edit.get("id")
    if not isinstance(edit_id, str) or not edit_id:
        fail("Play API did not return an edit id")

    track_url = f"{edit_url}/{edit_id}/tracks/production"
    try:
        track = request_json(track_url, headers=auth_headers)
    finally:
        # This is intentionally the only operation performed on the edit after
        # the read. Never replace this with edits.commit.
        delete_url = f"{edit_url}/{edit_id}"
        request_json(delete_url, method="DELETE", headers=auth_headers)

    completed_versions: list[int] = []
    for release in track.get("releases", []):
        if release.get("status") != "completed":
            continue
        if "userFraction" in release:
            continue
        for value in release.get("versionCodes", []):
            try:
                completed_versions.append(int(value))
            except (TypeError, ValueError):
                fail(f"Play returned a non-numeric versionCode: {value!r}")

    return max(completed_versions) if completed_versions else None


def vercel_headers() -> dict[str, str]:
    token = os.environ.get("VERCEL_TOKEN", "")
    if not token:
        fail("VERCEL_TOKEN is not configured")
    return {"Authorization": f"Bearer {token}"}


def vercel_url(path: str) -> str:
    project_id = os.environ.get("VERCEL_PROJECT_ID", "")
    if not project_id:
        fail("VERCEL_PROJECT_ID is not configured")
    team_id = os.environ.get("VERCEL_TEAM_ID", "")
    query = urlencode({"teamId": team_id}) if team_id else ""
    return f"{VERCEL_API_ROOT}{path}?{query}" if query else f"{VERCEL_API_ROOT}{path}"


def read_vercel_latest() -> tuple[int, str]:
    project_id = os.environ["VERCEL_PROJECT_ID"]
    response = request_json(
        vercel_url(f"/v9/projects/{project_id}/env"),
        headers=vercel_headers(),
    )
    candidates = [
        entry
        for entry in response.get("envs", [])
        if entry.get("key") == "LATEST_ANDROID_BUILD"
        and "production" in (entry.get("target") or [])
    ]
    if len(candidates) != 1:
        fail("expected exactly one production LATEST_ANDROID_BUILD variable in Vercel")
    entry = candidates[0]
    env_id = entry.get("id")
    if not isinstance(env_id, str) or not env_id:
        fail("Vercel LATEST_ANDROID_BUILD has no environment-variable id")
    # Ignore the list endpoint's value because it may be masked. Always use
    # the value returned by the individual environment-variable endpoint.
    detail = request_json(
        vercel_url(f"/v9/projects/{project_id}/env/{env_id}"),
        headers=vercel_headers(),
    )
    value = detail.get("value")
    if value is None:
        fail("Vercel did not return the current value of LATEST_ANDROID_BUILD")
    try:
        return int(str(value).strip()), env_id
    except (KeyError, TypeError, ValueError):
        fail("Vercel LATEST_ANDROID_BUILD is not a numeric value")


def update_vercel_latest(env_id: str, version_code: int) -> None:
    project_id = os.environ["VERCEL_PROJECT_ID"]
    request_json(
        vercel_url(f"/v9/projects/{project_id}/env/{env_id}"),
        method="PATCH",
        headers=vercel_headers(),
        body={"value": str(version_code), "target": ["production"]},
    )


def redeploy_vercel() -> None:
    hook_url = os.environ.get("VERCEL_DEPLOY_HOOK_URL", "")
    if not hook_url:
        fail("VERCEL_DEPLOY_HOOK_URL is not configured")
    request = Request(hook_url, data=b"", headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=30) as response:
            if response.status < 200 or response.status >= 300:
                fail(f"Vercel Deploy Hook returned HTTP {response.status}")
    except HTTPError as error:
        fail(f"Vercel Deploy Hook returned HTTP {error.code}")
    except URLError as error:
        fail(f"Vercel Deploy Hook failed: {error.reason}")


def read_public_latest() -> int | None:
    try:
        response = request_json(APP_CONFIG_URL)
    except SystemExit:
        return None
    value = response.get("latest_android_build")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def verify_redeployment(expected: int) -> None:
    deadline = time.monotonic() + 5 * 60
    while time.monotonic() < deadline:
        current = read_public_latest()
        if current == expected:
            print(f"Verified {APP_CONFIG_URL}: latest_android_build={expected}")
            return
        print(f"Waiting for Vercel deployment: expected={expected}, observed={current}")
        time.sleep(10)
    fail(f"{APP_CONFIG_URL} did not expose latest_android_build={expected} within 5 minutes")


def write_summary(
    play_version: int | None,
    current_version: int | None,
    public_version: int | None,
    action: str,
) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    lines = [
        "### Android Play/Vercel sync",
        "",
        f"- Play production completed versionCode: `{play_version if play_version is not None else 'none'}`",
        f"- Current Vercel LATEST_ANDROID_BUILD: `{current_version if current_version is not None else 'not read'}`",
        f"- Public `/api/app-config` latest_android_build: `{public_version if public_version is not None else 'not read'}`",
        f"- Action: {action}",
        "",
    ]
    with open(summary_path, "a", encoding="utf-8") as summary:
        summary.write("\n".join(lines))


def main() -> None:
    token = play_access_token()
    play_version = read_play_production_version(token)
    if play_version is None:
        print("No 100% completed production release was found; nothing to sync.")
        write_summary(None, None, None, "no-op; no completed 100% production release")
        return

    current_version, env_id = read_vercel_latest()
    public_version = read_public_latest()
    if public_version is None:
        write_summary(
            play_version,
            current_version,
            None,
            "failed; public API unavailable; no redeploy attempted",
        )
        fail("could not read public latest_android_build; refusing to redeploy blindly")

    env_action = "env already current"
    if play_version > current_version:
        update_vercel_latest(env_id, play_version)
        env_action = f"updated env to {play_version}"
        print(f"Updated Vercel LATEST_ANDROID_BUILD from {current_version} to {play_version}.")

    if public_version > play_version:
        print(f"No-op: public latest_android_build {public_version} is ahead of Play {play_version}; leaving it alone.")
        write_summary(
            play_version,
            current_version,
            public_version,
            "no-op; public value is ahead of Play",
        )
        return

    if public_version != play_version:
        print(
            f"Public latest_android_build is {public_version}; redeploying for Play versionCode {play_version}."
        )
        redeploy_vercel()
        verify_redeployment(play_version)
        public_version = play_version
        action = f"{env_action}; redeployed and verified"
    else:
        print(f"No-op: public latest_android_build already equals Play versionCode {play_version}.")
        action = (
            "no-op; Vercel is already current"
            if play_version == current_version
            else f"{env_action}; public value is current"
        )

    write_summary(play_version, current_version, public_version, action)


if __name__ == "__main__":
    main()
