"use client";

import { useState, useRef } from "react";
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

  const handleClick = () => {
    setShowModal(true);
    setError("");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 파일 크기 체크 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError("파일 크기는 5MB 이하만 가능합니다");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드 가능합니다");
      return;
    }

    setUploading(true);
    setError("");

    try {
      // 파일 확장자
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `${userId}/photo_${Date.now()}.${ext}`;

      // Storage 업로드
      const { error: uploadError } = await supabase.storage
        .from("member-photos")
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        setError(`업로드 실패: ${uploadError.message}`);
        setUploading(false);
        return;
      }

      // Public URL 생성
      const { data: urlData } = supabase.storage
        .from("member-photos")
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;

      // DB 업데이트
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
      setShowModal(false);
    } catch (e) {
      setError(`오류: ${(e as Error).message}`);
      setUploading(false);
    }
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
          /* 등록 안된 경우: 그림자 사람 모습 */
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

        {/* 호버 오버레이 + + 버튼 */}
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

        {/* 작은 + 배지 (항상 표시 - 모바일에서 호버 안 됨 보완) */}
        <div
          className="photo-plus-badge"
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

      {/* === 모달 === */}
      {showModal && (
        <div
          onClick={() => !uploading && setShowModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "28px 24px",
              maxWidth: 400,
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              fontFamily: "'Noto Sans KR', sans-serif",
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "#1e293b",
                marginBottom: 20,
                textAlign: "center",
              }}
            >
              📷 {label}
            </div>

            {/* 큰 이미지 미리보기 */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              {currentUrl ? (
                <img
                  src={currentUrl}
                  alt={label}
                  style={{
                    width: 200,
                    height: 200,
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
                    width: 200,
                    height: 200,
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
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    등록된 사진이 없습니다
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "#b91c1c",
                  marginBottom: 14,
                }}
              >
                ⚠️ {error}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setShowModal(false)}
                disabled={uploading}
                style={{
                  flex: 1,
                  padding: "13px",
                  background: "#f1f5f9",
                  color: "#64748b",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: uploading ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                닫기
              </button>
              <button
                onClick={triggerFileInput}
                disabled={uploading}
                style={{
                  flex: 1.5,
                  padding: "13px",
                  background: uploading
                    ? "#94a3b8"
                    : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: uploading ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  boxShadow: "0 6px 16px rgba(99, 102, 241, 0.3)",
                }}
              >
                {uploading
                  ? "업로드 중..."
                  : currentUrl
                  ? "📸 사진 변경"
                  : "📸 사진 등록"}
              </button>
            </div>

            <div
              style={{
                fontSize: 10,
                color: "#94a3b8",
                textAlign: "center",
                marginTop: 14,
                lineHeight: 1.5,
              }}
            >
              JPG, PNG, WebP, GIF · 최대 5MB
            </div>
          </div>
        </div>
      )}
    </>
  );
}
