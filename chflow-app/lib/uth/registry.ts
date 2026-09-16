// UTH device registry. SERVER-ONLY (contains raw MAC) — never import from client code.
// Interim static registry. DB-backed registry (uth_devices) is the productization step.
// 4 patch locations (303/402/403/405). 402 = 가정 테스트기(live). 나머지는 설치 예정(planned, MAC 미정).

export interface UthDevice {
  id: string; // stable device id used by the API/UI (no MAC exposed)
  mac?: string; // colon MAC — server-only; only for installed(live) devices
  facilityId: string; // room.id for floor-plan overlay (config lib/facility)
  roomNo: string; // 호실
  label: string;
  dept?: string;
  floor: number;
  controlEnabled: boolean; // per-device gate for write commands
  planned?: boolean; // true = 아직 실기기 미설치(제어 불가, 지도에 예정 표시)
}

const DEVICES: UthDevice[] = [
  // 가정 테스트기(초등1부 402호 스테이징) — 실제 원격제어 가능
  { id: "uth-402", mac: "A8:48:FA:FD:B3:26", facilityId: "vision-4f-class2", roomNo: "402", label: "교육실2", dept: "초등1부", floor: 4, controlEnabled: true },
  // 설치 예정(교회 실기기 설치 후 mac 등록 + controlEnabled=true + planned 제거)
  { id: "uth-303", facilityId: "vision-3f-infant", roomNo: "303", label: "유아부실", floor: 3, controlEnabled: false, planned: true },
  { id: "uth-403", facilityId: "vision-4f-teacher2", roomNo: "403", label: "교사실2", floor: 4, controlEnabled: false, planned: true },
  { id: "uth-405", facilityId: "vision-4f-class1", roomNo: "405", label: "교육실1", floor: 4, controlEnabled: false, planned: true },
];

export type PublicDevice = Omit<UthDevice, "mac">;

export function listDevices(): UthDevice[] {
  return DEVICES;
}

export function getDevice(id: string): UthDevice | null {
  return DEVICES.find((d) => d.id === id) ?? null;
}

export function getDeviceByFacility(facilityId: string): UthDevice | null {
  return DEVICES.find((d) => d.facilityId === facilityId) ?? null;
}

/** Strip server-only fields (MAC) before sending to the client. */
export function toPublic(d: UthDevice): PublicDevice {
  const { mac: _mac, ...pub } = d;
  void _mac;
  return pub;
}
