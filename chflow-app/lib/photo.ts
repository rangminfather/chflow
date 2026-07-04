// 사진 썸네일 URL 헬퍼 — /api/storage 이미지에 ?w= 파라미터를 붙이면
// 서버가 webp 썸네일(R2 캐시 + 브라우저 캐시 1일)로 응답한다.
// 아바타(≤64px 표시)는 128, 카드/모달(≤256px)은 256, 크게 보기는 512 권장.
export type ThumbWidth = 64 | 128 | 256 | 512;

export function photoThumb(url: string, w: ThumbWidth): string;
export function photoThumb(url: string | null | undefined, w: ThumbWidth): string | null;
export function photoThumb(url: string | null | undefined, w: ThumbWidth): string | null {
  if (!url) return null;
  if (!url.startsWith("/api/storage/")) return url; // 외부 URL·blob·data URI 는 그대로
  return `${url}${url.includes("?") ? "&" : "?"}w=${w}`;
}
