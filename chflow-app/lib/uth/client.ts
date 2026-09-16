// UTH-170WF server-side TCP client. Node.js runtime ONLY (uses `net`).
// Flow (verified): HTTP port lookup -> TCP connect -> server hello (CF 04 D3)
// -> 40B handshake -> read 0xBF status -> [optional] 13B control -> read 0xBF.
import net from "node:net";
import {
  buildControl,
  buildHandshake,
  parseFrame,
  parseStatus,
  resolveHost,
  lookupPath,
  normalizeMac,
  LOOKUP_HOST,
  LOOKUP_PORT,
  hex,
  type ControlCommand,
  type DeviceState,
} from "./protocol";

const LOOKUP_TIMEOUT_MS = 6000;
const TCP_CONNECT_TIMEOUT_MS = 6000;
const TCP_READ_TIMEOUT_MS = 8000;

export class UthError extends Error {
  constructor(message: string, readonly stage: string) {
    super(message);
    this.name = "UthError";
  }
}

/** POST aID=<MAC> to rChkPtUth(N).jsp, return the relay port. */
export async function lookupPort(mac: string): Promise<number> {
  const colon = normalizeMac(mac);
  const url = `http://${LOOKUP_HOST}:${LOOKUP_PORT}${lookupPath(mac)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
  let body: string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `aID=${encodeURIComponent(colon)}`,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new UthError(`lookup HTTP ${res.status}`, "lookup");
    body = await res.text();
  } catch (e) {
    if (e instanceof UthError) throw e;
    throw new UthError(`lookup failed: ${(e as Error).message}`, "lookup");
  } finally {
    clearTimeout(t);
  }
  const m = body.match(/port:(\d+)/);
  if (!m) throw new UthError(`no port in response: ${JSON.stringify(body.slice(0, 40))}`, "lookup");
  return parseInt(m[1], 10);
}

interface SessionResult<T> {
  value: T;
  frames: string[]; // hex of every frame received (audit/diagnostics)
}

/**
 * Open a session and run `step`. `step` gets a `send` fn and a `readFrame` fn.
 * The handshake is sent automatically after the server hello. Always closes.
 */
async function withSession<T>(
  host: string,
  port: number,
  handshake: Buffer,
  step: (io: {
    send: (b: Buffer) => void;
    readFrame: () => Promise<Buffer>;
  }) => Promise<T>
): Promise<SessionResult<T>> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    const frames: string[] = [];
    let buf = Buffer.alloc(0);
    let waiter: ((b: Buffer) => void) | null = null;
    let settled = false;

    const cleanup = () => {
      try {
        sock.destroy();
      } catch {
        /* noop */
      }
    };
    const fail = (msg: string, stage: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new UthError(msg, stage));
    };

    // deliver a complete frame: 3B hello, else 14B status / other
    const tryDeliver = () => {
      if (!waiter) return;
      if (buf.length === 3 && buf[0] === 0xcf) return flush(3);
      // find a 14-byte status or a >=3 control frame
      for (let i = 0; i + 14 <= buf.length; i++) {
        if (buf[i] === 0xbf) return flush(i + 14);
      }
      if (buf.length >= 3 && (buf[0] === 0xef || buf[0] === 0xbb)) return flush(buf.length);
    };
    const flush = (n: number) => {
      const frame = buf.subarray(0, n);
      buf = buf.subarray(n);
      frames.push(hex(frame));
      const w = waiter;
      waiter = null;
      w?.(Buffer.from(frame));
    };
    const readFrame = () =>
      new Promise<Buffer>((res, rej) => {
        const to = setTimeout(() => {
          waiter = null;
          rej(new UthError("read timeout", "read"));
        }, TCP_READ_TIMEOUT_MS);
        waiter = (b) => {
          clearTimeout(to);
          res(b);
        };
        tryDeliver();
      });

    sock.setTimeout(TCP_CONNECT_TIMEOUT_MS);
    sock.on("timeout", () => fail("socket timeout", "connect"));
    sock.on("error", (e) => fail(`socket error: ${e.message}`, "connect"));
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      tryDeliver();
    });

    sock.connect(port, host, async () => {
      sock.setTimeout(0);
      try {
        sock.write(handshake);
        const value = await step({ send: (b) => sock.write(b), readFrame });
        if (!settled) {
          settled = true;
          cleanup();
          resolve({ value, frames });
        }
      } catch (e) {
        fail((e as Error).message, (e as UthError).stage ?? "session");
      }
    });
  });
}

/** Read the current device status (one round trip). */
export async function readStatus(
  mac: string
): Promise<{ state: DeviceState; port: number; frames: string[] }> {
  const port = await lookupPort(mac);
  const host = resolveHost(mac);
  const handshake = buildHandshake(mac);
  const { value, frames } = await withSession(host, port, handshake, async ({ readFrame }) => {
    // skip non-status frames (hello) until we get a 0xBF/offline
    for (let i = 0; i < 3; i++) {
      const f = parseFrame(await readFrame());
      if (f.kind === "status") return parseStatus(Buffer.from(f.raw.replace(/ /g, ""), "hex"));
      if (f.kind === "offline") throw new UthError("device offline", "status");
      if (f.kind === "disconnect") throw new UthError(`disconnect code ${f.code}`, "status");
    }
    throw new UthError("no status frame", "status");
  });
  return { state: value, port, frames };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type ControlResult = { before: DeviceState; after: DeviceState; sent: string; port: number; frames: string[] };

/** Core: read current status, compute a command from it, send, read back. */
async function runControl(mac: string, compute: (before: DeviceState) => ControlCommand): Promise<ControlResult> {
  const port = await lookupPort(mac);
  const host = resolveHost(mac);
  const handshake = buildHandshake(mac);
  const { value, frames } = await withSession(host, port, handshake, async ({ send, readFrame }) => {
    let before: DeviceState | null = null;
    for (let i = 0; i < 3 && !before; i++) {
      const f = parseFrame(await readFrame());
      if (f.kind === "status") before = parseStatus(Buffer.from(f.raw.replace(/ /g, ""), "hex"));
      else if (f.kind === "offline") throw new UthError("device offline", "control");
      else if (f.kind === "disconnect") throw new UthError(`disconnect code ${f.code}`, "control");
    }
    if (!before) throw new UthError("no status before control", "control");
    const pkt = buildControl(before, compute(before));
    send(pkt);
    let after: DeviceState | null = null;
    for (let i = 0; i < 4 && !after; i++) {
      const f = parseFrame(await readFrame());
      if (f.kind === "status") after = parseStatus(Buffer.from(f.raw.replace(/ /g, ""), "hex"));
    }
    if (!after) throw new UthError("no status after control", "control");
    return { before, after, sent: hex(pkt) };
  });
  return { ...value, port, frames };
}

/** Send an explicit control command (power / setValue / lock). */
export function sendControl(mac: string, cmd: ControlCommand): Promise<ControlResult> {
  return runControl(mac, () => cmd);
}

/**
 * Relative setpoint step (▲▼). Clamps by mode:
 * modeType 0(온도) → [TL, TH]; modeType 1(단수) → [0, 8] (표시 1~9).
 */
export function sendStep(mac: string, dir: 1 | -1): Promise<ControlResult> {
  return runControl(mac, (b) => {
    const lo = b.modeType === 0 ? b.TL : 0;
    const hi = b.modeType === 0 ? b.TH : 8;
    return { setValue: clamp(b.sth + dir, lo, hi) };
  });
}

/** Run tasks with a concurrency cap (multi-device status polling). */
export async function withLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
