"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Cropper, { Area } from "react-easy-crop";
import { supabase } from "@/lib/supabase";
import { User, Camera, AlertTriangle, Images, ZoomIn, Crop as CropIcon, Undo2, X } from "lucide-react";

interface PhotoAvatarProps {
  userId: string;
  photoUrl: string | null;
  fallbackUrl?: string | null;
  hasCustomPhoto?: boolean;
  size?: number;
  label?: string;
  onUpdate?: (newUrl: string | null) => void;
}

interface GalleryItem {
  name: string;
  url: string;
  createdAt: string | null;
}

const MAX_GALLERY = 3;

function withCacheBust(url: string) {
  return `${url.split("?")[0]}?t=${Date.now()}`;
}

export default function PhotoAvatar({
  userId,
  photoUrl,
  fallbackUrl = null,
  hasCustomPhoto,
  size = 80,
  label = "요람 사진",
  onUpdate,
}: PhotoAvatarProps) {
  const [showModal, setShowModal] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [currentUrl, setCurrentUrl] = useState<string | null>(photoUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setCurrentUrl(photoUrl); }, [photoUrl]);

  // === 크롭 상태 ===
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  // === 갤러리 상태 ===
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const loadGallery = useCallback(async () => {
    setLoadingGallery(true);
    const { data, error: listError } = await supabase.storage
      .from("member-photos")
      .list(userId, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
    if (listError) {
      setLoadingGallery(false);
      return;
    }
    const items: GalleryItem[] = (data || [])
      .filter((f) => !f.name.startsWith(".") && f.name !== "profile.png")
      .map((f) => {
        const path = `${userId}/${f.name}`;
        const { data: u } = supabase.storage.from("member-photos").getPublicUrl(path);
        return { name: f.name, url: u.publicUrl, createdAt: f.created_at };
      });
    setGallery(items);
    setLoadingGallery(false);
  }, [userId]);

  useEffect(() => {
    if (showModal && !cropImageSrc) loadGallery();
  }, [showModal, cropImageSrc, loadGallery]);

  const handleClick = () => {
    setShowModal(true);
    setError("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (gallery.length >= MAX_GALLERY) {
      setError(`사진은 최대 ${MAX_GALLERY}장까지만 올릴 수 있습니다. 기존 사진을 삭제해주세요.`);
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("파일 크기는 10MB 이하만 가능합니다");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드 가능합니다");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
      setError("");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
  };

  const getCroppedBlob = async (
    imageSrc: string,
    pixelCrop: Area,
    targetSize = 512
  ): Promise<Blob | null> => {
    const image = await createImage(imageSrc);
    const canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      targetSize,
      targetSize
    );

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
    });
  };

  const handleCropConfirm = async () => {
    if (!cropImageSrc || !croppedAreaPixels) return;
    setUploading(true);
    setError("");

    try {
      const blob = await getCroppedBlob(cropImageSrc, croppedAreaPixels, 512);
      if (!blob) {
        setError("이미지 처리 실패");
        setUploading(false);
        return;
      }

      const fileName = `${userId}/photo_${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("member-photos")
        .upload(fileName, blob, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        setError(`업로드 실패: ${uploadError.message}`);
        setUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("member-photos")
        .getPublicUrl(fileName);

      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: rpcError } = await supabase.rpc("update_my_photo", {
        p_photo_url: publicUrl,
      });

      if (rpcError) {
        setError(`저장 실패: ${rpcError.message}`);
        setUploading(false);
        return;
      }

      setCurrentUrl(publicUrl);
      onUpdate?.(publicUrl);
      setUploading(false);
      setCropImageSrc(null);
      await loadGallery();
    } catch (e) {
      setError(`오류: ${(e as Error).message}`);
      setUploading(false);
    }
  };

  const handleCropCancel = () => {
    setCropImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleSelectPhoto = async (rawUrl: string) => {
    const cacheBusted = withCacheBust(rawUrl);
    const { error: rpcError } = await supabase.rpc("update_my_photo", {
      p_photo_url: cacheBusted,
    });
    if (rpcError) {
      setError(`저장 실패: ${rpcError.message}`);
      return;
    }
    setCurrentUrl(cacheBusted);
    onUpdate?.(cacheBusted);
  };

  const handleDeletePhoto = async (item: GalleryItem) => {
    if (!confirm("이 사진을 삭제하시겠습니까?")) return;
    const path = `${userId}/${item.name}`;
    setDeletingPath(path);
    const { error: rmError } = await supabase.storage
      .from("member-photos")
      .remove([path]);
    if (rmError) {
      setDeletingPath(null);
      setError(`삭제 실패: ${rmError.message}`);
      return;
    }
    // 현재 표시 중이던 사진을 지운 경우 avatar_url 비우고 fallback 으로
    if (currentUrl && currentUrl.split("?")[0] === item.url.split("?")[0]) {
      await supabase.rpc("update_my_photo", { p_photo_url: null });
      const next = fallbackUrl ?? null;
      setCurrentUrl(next);
      onUpdate?.(next);
    }
    setGallery((g) => g.filter((x) => x.name !== item.name));
    setDeletingPath(null);
  };

  const handleClearAvatar = async () => {
    if (!confirm("요람 사진으로 되돌리시겠습니까?")) return;
    const { error: rpcError } = await supabase.rpc("update_my_photo", {
      p_photo_url: null,
    });
    if (rpcError) {
      setError(`처리 실패: ${rpcError.message}`);
      return;
    }
    const next = fallbackUrl ?? null;
    setCurrentUrl(next);
    onUpdate?.(next);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const isShowingFallback = !!fallbackUrl && !hasCustomPhoto && currentUrl === fallbackUrl;
  const canRevertToFallback = !!fallbackUrl && (hasCustomPhoto ?? !isShowingFallback);

  return (
    <>
      {/* === 사진 표시 === */}
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {currentUrl ? (
          <img
            src={currentUrl}
            alt={label}
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              objectFit: "cover",
              objectPosition: "center top",
              border: "2px solid rgba(255,255,255,0.4)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            }}
          />
        ) : (
          <div
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--ink-mid), var(--ink-mid))",
              border: "2px solid rgba(255,255,255,0.4)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: size * 0.5,
              color: "rgba(255,255,255,0.6)",
            }}
          >
            <User size={size * 0.5} strokeWidth={1.6} />
          </div>
        )}

        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: hovering ? 1 : 0,
            transition: "opacity 0.2s",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: size * 0.5,
              height: size * 0.5,
              borderRadius: "50%",
              background: "var(--card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: size * 0.3,
              fontWeight: 800,
              color: "var(--accent)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            +
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.45)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 800,
            border: "2px solid var(--card)",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
            pointerEvents: "none",
          }}
        >
          +
        </div>
      </div>

      {/* === 메인 모달 === */}
      {showModal && !cropImageSrc && (
        <div
          onClick={() => !uploading && setShowModal(false)}
          style={modalOverlayStyle}
        >
          <div onClick={(e) => e.stopPropagation()} style={modalCardStyle}>
            <div style={{ ...modalTitleStyle, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Camera size={20} strokeWidth={1.8} /> {label}</div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              {currentUrl ? (
                <img
                  src={currentUrl}
                  alt={label}
                  style={{
                    width: 200, height: 200,
                    borderRadius: 16,
                    objectFit: "cover",
                    objectPosition: "center top",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                    border: "3px solid var(--hairline)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 200, height: 200,
                    borderRadius: 16,
                    background: "linear-gradient(135deg, var(--bg-soft), var(--hairline))",
                    border: "3px dashed var(--hairline-strong)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--ink-faint)",
                  }}
                >
                  <div style={{ marginBottom: 8, display: "flex" }}><User size={48} strokeWidth={1.4} /></div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>등록된 사진이 없습니다</div>
                </div>
              )}
            </div>

            {isShowingFallback && (
              <div style={{
                fontSize: 11, color: "var(--ink-soft)", textAlign: "center",
                marginBottom: 12, fontWeight: 600,
              }}>
                요람 사진을 표시 중
              </div>
            )}

            {error && <div style={{ ...errorBoxStyle, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />

            {/* 갤러리 */}
            <div style={{
              marginBottom: 14,
              padding: "12px 14px",
              background: "var(--surface)",
              borderRadius: 12,
            }}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: "var(--ink-mid)",
                marginBottom: 10, display: "flex", justifyContent: "space-between",
              }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Images size={14} strokeWidth={1.8} /> 내가 올린 사진</span>
                <span style={{ color: "var(--ink-faint)", fontWeight: 500 }}>{gallery.length} / {MAX_GALLERY}</span>
              </div>

              {loadingGallery ? (
                <div style={{ fontSize: 11, color: "var(--ink-faint)", textAlign: "center", padding: 12 }}>
                  불러오는 중...
                </div>
              ) : gallery.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--ink-faint)", textAlign: "center", padding: 12 }}>
                  아직 올린 사진이 없습니다
                </div>
              ) : (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 8,
                }}>
                  {gallery.map((item) => {
                    const isCurrent =
                      !!currentUrl &&
                      currentUrl.split("?")[0] === item.url.split("?")[0];
                    const isDeleting = deletingPath === `${userId}/${item.name}`;
                    return (
                      <div key={item.name} style={{ position: "relative" }}>
                        <img
                          src={item.url}
                          alt=""
                          onClick={() => !isCurrent && handleSelectPhoto(item.url)}
                          style={{
                            width: "100%",
                            aspectRatio: "1",
                            objectFit: "cover",
                            objectPosition: "center top",
                            borderRadius: 8,
                            cursor: isCurrent ? "default" : "pointer",
                            border: isCurrent
                              ? "3px solid var(--accent)"
                              : "1px solid var(--hairline)",
                            opacity: isDeleting ? 0.4 : 1,
                          }}
                        />
                        {isCurrent && (
                          <div style={{
                            position: "absolute", top: 4, left: 4,
                            background: "var(--accent)", color: "#fff",
                            fontSize: 9, fontWeight: 800,
                            padding: "2px 6px", borderRadius: 6,
                          }}>현재</div>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePhoto(item);
                          }}
                          disabled={isDeleting}
                          aria-label="삭제"
                          style={{
                            position: "absolute", top: 2, right: 2,
                            width: 22, height: 22, borderRadius: "50%",
                            background: "rgba(43, 39, 34, 0.75)", color: "#fff",
                            border: "none", cursor: "pointer",
                            fontSize: 11, fontWeight: 800,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        ><X size={12} strokeWidth={2.2} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: canRevertToFallback ? 8 : 0 }}>
              <button onClick={() => setShowModal(false)} style={btnSecondaryStyle}>닫기</button>
              <button
                onClick={triggerFileInput}
                disabled={gallery.length >= MAX_GALLERY}
                style={{
                  ...btnPrimaryStyle,
                  ...(gallery.length >= MAX_GALLERY
                    ? { background: "var(--hairline-strong)", boxShadow: "none", cursor: "not-allowed" }
                    : {}),
                }}
                title={gallery.length >= MAX_GALLERY ? "사진 슬롯이 가득 찼습니다" : ""}
              >
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Camera size={15} strokeWidth={1.8} />
                  {gallery.length >= MAX_GALLERY
                    ? `${MAX_GALLERY}장 가득`
                    : currentUrl ? "새 사진" : "사진 등록"}
                </span>
              </button>
            </div>

            {canRevertToFallback && (
              <button onClick={handleClearAvatar} style={{ ...btnFallbackStyle, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Undo2 size={14} strokeWidth={1.8} /> 요람 사진으로 되돌리기
              </button>
            )}

            <div style={{ fontSize: 10, color: "var(--ink-faint)", textAlign: "center", marginTop: 12 }}>
              JPG, PNG, WebP, GIF · 최대 10MB
            </div>
          </div>
        </div>
      )}

      {/* === 크롭 모달 === */}
      {showModal && cropImageSrc && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, maxWidth: 480, padding: "20px 16px" }}>
            <div style={{ ...modalTitleStyle, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><CropIcon size={20} strokeWidth={1.8} /> 영역 선택</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", textAlign: "center", marginBottom: 14, lineHeight: 1.5 }}>
              사진을 드래그하여 위치 조정<br />
              슬라이더로 확대/축소 (얼굴이 잘 보이도록)
            </div>

            <div style={{
              position: "relative",
              width: "100%",
              aspectRatio: "1",
              background: "#000",
              borderRadius: 14,
              overflow: "hidden",
              marginBottom: 16,
            }}>
              <Cropper
                image={cropImageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}><ZoomIn size={13} strokeWidth={1.8} /> 확대/축소</span>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{zoom.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                style={{
                  width: "100%",
                  accentColor: "var(--accent)",
                }}
              />
            </div>

            {error && <div style={{ ...errorBoxStyle, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleCropCancel}
                disabled={uploading}
                style={btnSecondaryStyle}
              >
                다시 선택
              </button>
              <button
                onClick={handleCropConfirm}
                disabled={uploading}
                style={{
                  ...btnPrimaryStyle,
                  background: uploading
                    ? "var(--ink-faint)"
                    : "linear-gradient(135deg, var(--success), var(--success))",
                  boxShadow: "0 6px 16px rgba(61, 122, 78, 0.3)",
                }}
              >
                {uploading ? "업로드 중..." : "✓ 이렇게 사용"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (e) => reject(e));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });
}

// === 스타일 ===
const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 200,
  padding: 20,
};

const modalCardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 20,
  padding: "24px 20px",
  maxWidth: 420,
  width: "100%",
  maxHeight: "92vh",
  overflowY: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "var(--ink)",
  marginBottom: 14,
  textAlign: "center",
};

const errorBoxStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "var(--danger-soft)",
  border: "1px solid var(--danger-soft)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--danger)",
  marginBottom: 14,
};

const btnSecondaryStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px",
  background: "var(--bg-soft)",
  color: "var(--ink-soft)",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const btnPrimaryStyle: React.CSSProperties = {
  flex: 1.5,
  padding: "12px",
  background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 6px 16px rgba(62, 90, 74, 0.3)",
};

const btnFallbackStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px",
  background: "var(--card)",
  color: "var(--ink-soft)",
  border: "1px solid var(--hairline-strong)",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};
