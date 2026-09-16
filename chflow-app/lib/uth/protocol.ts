// UTH-170WF / 210WF wire protocol — pure, dependency-free, server-only logic.
// Reverse-engineered and verified end-to-end against a real device (2026-09).
// See memory: uth-heating-project. NOTE: keep protocol details server-side only.

export const LOOKUP_HOST = "ban.u153.co.kr";
export const LOOKUP_PORT = 9083;
export const LOOKUP_PATH_STD = "/rChkPtUth.jsp";
export const LOOKUP_PATH_N = "/rChkPtUthN.jsp";

export const HOST_STD = "app.u153.co.kr"; // mIDK 0 (svrNm1)
export const HOST_N = "ban.u153.co.kr"; // mIDK 2 (svrNm2)

// Frame headers
const H_STATUS = 0xbf; // device status (14 bytes)
const H_OFFLINE = 0xef; // server: device disconnected  (+ [1]=0xAB)
const H_DISCONN = 0xbb; // server: disconnect notice     (+ [1]=0xAB)
const H_HELLO = 0xcf; // server hello on connect (3 bytes CF 04 D3)
const H_HANDSHAKE = 0xab;
const H_CONTROL = 0xaf;

export type Endpoint = "std" | "n";

export interface DeviceState {
  power: boolean; // pwT  (bit7)
  run: boolean; // RLOUT (bit4) — heating output on
  modeType: number; // 0 = 온도, 1 = 시간비례/단수
  useSvr: number; // bit5
  lock: boolean; // bit3
  sth: number; // 설정값 (온도 or 단수 raw)
  rth: number; // 현재온도 raw
  timeP: number; // 반복주기 raw
  TL: number;
  TH: number;
  DIF: number;
  DLY: number;
  OHT: number;
  RES: number;
  error: { overheat: boolean; sensorOpen: boolean; sensorShort: boolean; any: boolean };
  checksumOk: boolean;
  raw: string; // hex
}

export type Frame =
  | ({ kind: "status" } & DeviceState)
  | { kind: "offline"; raw: string }
  | { kind: "disconnect"; code: number; raw: string }
  | { kind: "hello"; raw: string }
  | { kind: "unknown"; raw: string };

// signed<->unsigned byte helpers (mirror A03.CheckMinus / MakeMinus)
export const checkMinus = (i: number): number => (i > 225 ? i - 256 : i);
export const makeMinus = (i: number): number => (i < 0 ? i + 256 : i) & 0xff;

export function hex(buf: Buffer | number[]): string {
  return Buffer.from(buf as number[])
    .toString("hex")
    .replace(/(..)/g, "$1 ")
    .trim()
    .toUpperCase();
}

/** Normalize any MAC form to colon-separated uppercase "AA:BB:CC:DD:EE:FF". */
export function normalizeMac(mac: string): string {
  const clean = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (clean.length !== 12) throw new Error(`invalid MAC: ${mac}`);
  return clean.match(/.{2}/g)!.join(":");
}

/** Registration-endpoint selection (B11.readPort): A848/68C6/C8C9/BCFF → N. */
export function resolveEndpoint(mac: string): Endpoint {
  const p = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 4);
  return ["A848", "68C6", "C8C9", "BCFF"].includes(p) ? "n" : "std";
}

/** Control-socket host (A02 runtime mIDK): 68:C6/C8:C9/BC:FF → ban, else app. */
export function resolveHost(mac: string): string {
  const p = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 4);
  return ["68C6", "C8C9", "BCFF"].includes(p) ? HOST_N : HOST_STD;
}

export function lookupPath(mac: string): string {
  return resolveEndpoint(mac) === "n" ? LOOKUP_PATH_N : LOOKUP_PATH_STD;
}

/** 40-byte session handshake — A03.sendData(0). appIp is always "" in the app. */
export function buildHandshake(mac: string, appIp = ""): Buffer {
  const colon = normalizeMac(mac);
  const b = Buffer.from("xx" + colon + "000.000.000.000000000", "latin1"); // 40 bytes
  b[0] = H_HANDSHAKE; // 0xAB
  b[1] = 0x0c;
  for (let i = appIp.length + 19; i < 34; i++) b[i] = 0;
  b[39] = 0xff;
  return b;
}

export interface ControlCommand {
  power?: boolean;
  setValue?: number; // 온도(modeType0) 또는 단수 raw(modeType1)
  lock?: boolean;
}

/** 13-byte control frame — A03.sendData(10). Preserves current config, changes only requested. */
export function buildControl(cur: DeviceState, cmd: ControlCommand): Buffer {
  const targetPwT = cmd.power !== undefined ? (cmd.power ? 1 : 0) : cur.power ? 1 : 0;
  const mSend10 = cmd.setValue !== undefined ? 1 : 0;
  const mSend11 = cmd.lock !== undefined ? 1 : 0;
  const mSend12 = cmd.power !== undefined ? 1 : 0;
  const targetLk = cmd.lock !== undefined ? (cmd.lock ? 1 : 0) : cur.lock ? 1 : 0;
  const sth = cmd.setValue !== undefined ? cmd.setValue : cur.sth;

  let f = (targetPwT * 128) & 0xff;
  f = (f + 32) & 0xff;
  if (cur.modeType === 1) f = (f + 64) & 0xff;
  if (mSend10) f = (f + 1) & 0xff;
  if (mSend11) {
    if (targetLk === 1) f = (f + 16) & 0xff;
    f = (f + 2) & 0xff;
  }
  if (mSend12) f = (f + 4) & 0xff;

  const b = Buffer.alloc(13);
  b[0] = H_CONTROL; // 0xAF
  b[1] = 0;
  b[2] = 0;
  b[3] = f;
  b[4] = makeMinus(sth);
  b[5] = cur.timeP & 0xff;
  b[6] = makeMinus(cur.TL);
  b[7] = makeMinus(cur.TH);
  b[8] = cur.DIF & 0xff;
  b[9] = cur.DLY & 0xff;
  b[10] = cur.OHT & 0xff;
  b[11] = makeMinus(cur.RES);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum = (sum + b[i]) & 0xff;
  b[12] = sum;
  return b;
}

/** Parse an incoming frame. Accepts a buffer starting at (or containing) a known header. */
export function parseFrame(buf: Buffer): Frame {
  const raw = hex(buf);
  if (buf.length === 3 && buf[0] === H_HELLO) return { kind: "hello", raw };
  // locate a 0xBF status frame anywhere in the buffer
  let idx = -1;
  for (let i = 0; i + 14 <= buf.length; i++)
    if (buf[i] === H_STATUS) {
      idx = i;
      break;
    }
  if (idx >= 0) return parseStatus(buf.subarray(idx, idx + 14));
  if (buf[0] === H_OFFLINE && buf[1] === 0xab) return { kind: "offline", raw };
  if (buf[0] === H_DISCONN && buf[1] === 0xab) return { kind: "disconnect", code: buf[2], raw };
  return { kind: "unknown", raw };
}

export function parseStatus(f: Buffer): { kind: "status" } & DeviceState {
  let sum = 0;
  for (let i = 0; i < 13; i++) sum = (sum + f[i]) & 0xff;
  const s = f[3];
  const modeType = (s & 0x40) >> 6;
  const sensorOpen = ((s & 0x04) >> 2) === 1 && modeType === 0;
  const sensorShort = ((s & 0x02) >> 1) === 1;
  const overheat = (s & 0x01) === 1;
  return {
    kind: "status",
    power: ((s & 0x80) >> 7) === 1,
    run: ((s & 0x10) >> 4) === 1,
    modeType,
    useSvr: (s & 0x20) >> 5,
    lock: ((s & 0x08) >> 3) === 1,
    sth: checkMinus(f[4]),
    rth: checkMinus(f[5]),
    timeP: f[6],
    TL: checkMinus(f[7]),
    TH: checkMinus(f[8]),
    DIF: f[9],
    DLY: f[10],
    OHT: f[11],
    RES: checkMinus(f[12]),
    error: { overheat, sensorOpen, sensorShort, any: overheat || sensorShort || sensorOpen },
    checksumOk: (f[13] & 0xff) === sum,
    raw: hex(f),
  };
}

/** UI-facing view derived from raw state (mirrors A03.pvDispTop). */
export interface DisplayState {
  powerOn: boolean;
  run: boolean;
  lock: boolean;
  mode: "temp" | "level";
  curTemp: number | null; // modeType 0 only
  setTemp: number | null; // modeType 0 only
  timeCycle: number | null; // modeType 1 only (반복주기)
  heatLevel: string | null; // modeType 1 only (예: "4 L")
  error: DeviceState["error"];
}

export function deriveDisplay(st: DeviceState): DisplayState {
  if (st.modeType === 0) {
    return {
      powerOn: st.power,
      run: st.run,
      lock: st.lock,
      mode: "temp",
      curTemp: st.rth + st.RES,
      setTemp: st.power ? st.sth + st.RES : null,
      timeCycle: null,
      heatLevel: null,
      error: st.error,
    };
  }
  return {
    powerOn: st.power,
    run: st.run,
    lock: st.lock,
    mode: "level",
    curTemp: null,
    setTemp: null,
    timeCycle: st.timeP + 1,
    heatLevel: st.power ? `${st.sth + 1} ${st.sth < 5 ? "L" : "H"}` : null,
    error: st.error,
  };
}
