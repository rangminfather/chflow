"use client";

import { useState, useRef, useCallback } from "react";
import Cropper, { Area } from "react-easy-crop";
import { supabase } from "@/lib/supabase";

interface PhotoAvatarProps {
  userId: string;
  photoUrl: string | null;
  size?: number;
  label?: string;
  onUpdate?: (newUrl: string) => void;
}

export default function PhotoAvatar({
  userId,
  photoUrl,
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

  // === 크롭 상태 ===
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleClick = () => {
    setShowModal(true);
    setError("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("파일 크기는 10MB 이하만 가능합니다");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드 가능합니다");
      return;
    }

    // 파일을 dataURL로 읽어서 크롭 모달로 전달
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
      setError("");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
  };

  // === 크롭한 이미지를 캔버스로 그려서 Blob 생성 ===
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
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/jpeg",
        0.85  // 85% quality - 자동 압축
      );
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

      // 파일 업로드
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

      // cache busting
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
      setShowModal(false);
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

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

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
              background: "linear-gradient(135deg, #475569, #334155)",
              border: "2px solid rgba(255,255,255,0.4)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: size * 0.5,
              color: "rgba(255,255,255,0.6)",
            }}
          >
            👤
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
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: size * 0.3,
              fontWeight: 900,
              color: "#6366f1",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            +
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#6366f1",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 900,
            border: "2px solid #fff",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
            pointerEvents: "none",
          }}
        >
          +
        </div>
      </div>

      {/* === 메인 모달 (현재 사진 보기 / 변경) === */}
      {showModal && !cropImageSrc && (
        <div
          onClick={() => !uploading && setShowModal(false)}
          style={modalOverlayStyle}
        >
          <div onClick={(e) => e.stopPropagation()} style={modalCardStyle}>
            <div style={modalTitleStyle}>📷 {label}</div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              {currentUrl ? (
                <img
                  src={currentUrl}
                  alt={label}
                  style={{
                    width: 220, height: 220,
                    borderRadius: 16,
                    objectFit: "cover",
                    objectPosition: "center top",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                    border: "3px solid #e2e8f0",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 220, height: 220,
                    borderRadius: 16,
                    background: "linear-gradient(135deg, #f1f5f9, #e2e8f0)",
                    border: "3px dashed #cbd5e1",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                  }}
                >
                  <div style={{ fontSize: 64, marginBottom: 8 }}>👤</div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>등록된 사진이 없습니다</div>
                </div>
              )}
            </div>

            {error && <div style={errorBoxStyle}>⚠️ {error}</div>}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowModal(false)} style={btnSecondaryStyle}>닫기</button>
              <button onClick={triggerFileInput} style={btnPrimaryStyle}>
                {currentUrl ? "📸 사진 변경" : "📸 사진 등록"}
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 14 }}>
              JPG, PNG, WebP, GIF · 최대 10MB
            </div>
          </div>
        </div>
      )}

      {/* === 크롭 모달 === */}
      {showModal && cropImageSrc && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, maxWidth: 480, padding: "20px 16px" }}>
            <div style={modalTitleStyle}>✂️ 영역 선택</div>
            <div style={{ fontSize: 11, color: "#64748b", textAlign: "center", marginBottom: 14, lineHeight: 1.5 }}>
              사진을 드래그하여 위치 조정<br />
              슬라이더로 확대/축소 (얼굴이 잘 보이도록)
            </div>

            {/* Cropper */}
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

            {/* Zoom Slider */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>🔍 확대/축소</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{zoom.toFixed(1)}x</span>
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
                  accentColor: "#6366f1",
                }}
              />
            </div>

            {error && <div style={errorBoxStyle}>⚠️ {error}</div>}

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
                    ? "#94a3b8"
                    : "linear-gradient(135deg, #10b981, #059669)",
                  boxShadow: "0 6px 16px rgba(16, 185, 129, 0.3)",
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

// 이미지 로드 헬퍼
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
  background: "#fff",
  borderRadius: 20,
  padding: "28px 24px",
  maxWidth: 400,
  width: "100%",
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#1e293b",
  marginBottom: 16,
  textAlign: "center",
};

const errorBoxStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 10,
  fontSize: 12,
  color: "#b91c1c",
  marginBottom: 14,
};

const btnSecondaryStyle: React.CSSProperties = {
  flex: 1,
  padding: "13px",
  background: "#f1f5f9",
  color: "#64748b",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const btnPrimaryStyle: React.CSSProperties = {
  flex: 1.5,
  padding: "13px",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 6px 16px rgba(99, 102, 241, 0.3)",
};
