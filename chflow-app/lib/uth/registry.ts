// UTH device registry. SERVER-ONLY (contains raw MAC) — never import from client code.
// Interim static registry for home testing. Church devices + DB-backed registry
// (uth_devices table) come in a later step; keep this list the single source until then.

export interface UthDevice {
  id: string; // stable device id used by the API/UI (no MAC exposed)
  mac: string; // colon MAC — server-only
  facilityId: string; // room.id for floor-plan overlay
  roomNo: string; // 호실
  label: string;
  dept?: string;
  controlEnabled: boolean; // per-device gate for write commands
}

// 가정 테스트기(초등1부 402호 스테이징). 교회 실기기는 추후 확장 시 실제 MAC으로 추가.
const DEVICES: UthDevice[] = [
  {
    id: "uth-402-test",
    mac: "A8:48:FA:FD:B3:26",
    facilityId: "vision-4f-class2",
    roomNo: "402",
    label: "402호 교육실2",
    dept: "초등1부",
    controlEnabled: true,
  },
];

export type PublicDevice = Omit<UthDevice, "mac">;

export function listDevices(): UthDevice[] {
  return DEVICES;
}

export function getDevice(id: string): UthDevice | null {
  return DEVICES.find((d) => d.id === id) ?? null;
}

/** Strip server-only fields (MAC) before sending to the client. */
export function toPublic(d: UthDevice): PublicDevice {
  const { mac: _mac, ...pub } = d;
  void _mac;
  return pub;
}
