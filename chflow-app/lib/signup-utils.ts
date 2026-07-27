export function signupDisplayGender(value?: string | null) {
  if (value === "M") return "남";
  if (value === "F") return "여";
  return value || "";
}

export function normalizeSignupGender(value?: string | null) {
  if (value === "남") return "M";
  if (value === "여") return "F";
  return value || "";
}

export function signupErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "알 수 없는 오류";
}

export function normalizeSignupSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[·/.,_-]/g, "").replace(/목장/g, "");
}

export function maskSignupName(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 1) return `${trimmed}*`;
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}*${trimmed.slice(-1)}`;
}

export function maskSignupBirthDate(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 2)}**-**-${digits.slice(6, 8)}`;
  if (digits.length >= 4) return `${digits.slice(0, 2)}**-**`;
  return "**";
}

export function maskSignupPhone(phone: string): string {
  if (!phone) return "";
  const match = phone.match(/^(\d{2,3})-?(\d{3,4})-?(\d{4})$/);
  return match ? `${match[1]}-****-${match[3]}` : phone;
}

export function maskSignupAddress(address: string): string {
  if (!address) return "";
  const parts = address.split(/\s+/);
  return parts.length <= 2 ? address : `${parts.slice(0, 2).join(" ")} ***`;
}

export type SignupLookupInput = {
  name: string;
  phone: string;
  noPhone: boolean;
  parentName: string;
  parentPhone: string;
};

export function validateSignupLookup(input: SignupLookupInput): string | null {
  if (!input.name.trim()) return "이름을 입력하세요";
  if (!input.noPhone && !input.phone.trim()) return "휴대폰 번호를 입력하세요";
  if (input.noPhone && !input.parentName.trim()) return "부모님 이름을 입력하세요";
  if (input.noPhone && !input.parentPhone.trim()) return "부모님 휴대폰 번호를 입력하세요";
  return null;
}
