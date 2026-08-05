import fs from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_URL = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const ENV_FILE = process.argv[2] || process.env.YOUTUBE_OAUTH_ENV_FILE;

function loadEnvFile(filePath) {
  if (!filePath) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(YOUTUBE_OAUTH_(?:CLIENT_ID|CLIENT_SECRET|REFRESH_TOKEN))=(.*)\s*$/);
    if (!match) continue;

    let value = match[2].trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function safeErrorCode(json, fallback) {
  const code = json && typeof json.error === "string" ? json.error : fallback;
  return code.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
}

function safeErrorReason(json) {
  const reason = json && typeof json.error_description === "string"
    ? json.error_description
    : json && typeof json.error?.message === "string"
      ? json.error.message
      : "unknown";
  return reason.replace(/[\r\n]+/g, " ").replace(/[^a-zA-Z0-9 .,:'()/_-]/g, "").slice(0, 200);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function exchangeRefreshToken() {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID,
      client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const json = await readJson(response);

  if (!response.ok || typeof json.access_token !== "string") {
    return {
      ok: false,
      status: response.status,
      code: safeErrorCode(json, `token_http_${response.status}`),
      reason: safeErrorReason(json),
    };
  }

  return { ok: true, status: response.status, accessToken: json.access_token };
}

async function queryBroadcasts(accessToken, broadcastStatus) {
  const params = new URLSearchParams({
    part: "id,snippet,status,contentDetails",
    mine: "true",
    broadcastStatus,
  });
  const response = await fetch(`${API_URL}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const json = await readJson(response);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: safeErrorCode(json, `api_http_${response.status}`),
      reason: safeErrorReason(json),
    };
  }

  return {
    ok: true,
    status: response.status,
    count: Array.isArray(json.items) ? json.items.length : 0,
  };
}

async function main() {
  loadEnvFile(ENV_FILE);

  const configured = [
    process.env.YOUTUBE_OAUTH_CLIENT_ID,
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
    process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
  ].every((value) => typeof value === "string" && value.length > 0);

  console.log(`oauth_configured=${configured}`);
  if (!configured) {
    console.log("result=not_run reason=missing_oauth_environment_variables");
    process.exitCode = 2;
    return;
  }

  const token = await exchangeRefreshToken();
  console.log(`token_exchange_ok=${token.ok} http_status=${token.status}`);
  if (!token.ok) {
    console.log(`error_code=${token.code} error_reason=${token.reason}`);
    process.exitCode = 2;
    return;
  }

  for (const broadcastStatus of ["active", "upcoming"]) {
    const result = await queryBroadcasts(token.accessToken, broadcastStatus);
    console.log(`${broadcastStatus}_request_ok=${result.ok} http_status=${result.status}`);
    if (!result.ok) {
      console.log(`${broadcastStatus}_error_code=${result.code} ${broadcastStatus}_error_reason=${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${broadcastStatus}_count=${result.count}`);
  }

  console.log("result=oauth_api_read_test_succeeded");
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : "request_failed";
  console.log(`result=not_run error_reason=${reason.replace(/[\r\n]+/g, " ").slice(0, 200)}`);
  process.exitCode = 1;
});
