"use client";

// 학생(아이) 프로필 사진 등록/교체/삭제 위젯.
// - 사진이 없으면 성별별 기본 얼굴(kidDefaultFace)을 보여준다.
// - 아바타를 누르면 모달에서 사진 등록(크롭) · 기본 얼굴로 되돌리기.
// - 저장 권한은 RPC edu_set_student_photo(= edu_can_edit_student)로 검증된다.
// - 연결된 member_id 가 없으면 사진을 저장할 수 없어 업로드 버튼을 막는다.

import { useState, useRef, useCallback, useEffect } from "react";
import Cropper, { Area } from "react-easy-crop";
import { supabase } from "@/lib/supabase";
import { Camera, AlertTriangle, ZoomIn, Crop as CropIcon, Undo2, Plus, Check } from "lucide-react";
import { kidDefaultFace, isKidDefaultFace, kidFaceChoices, kidFaceTransform } from "@/lib/kidAvatar";

interface StudentPhotoEditorProps {
  deptId: string;
  studentId: string;
  memberId: string | null;
  name: string;
  gender: string | null | undefined;
  photoUrl: string | null | undefined;
  size?: number;
  onUpdate?: (newUrl: string | null) => void;
}

export default function StudentPhotoEditor({
  deptId,
  studentId,
  memberId,
  name,
  gender,
  photoUrl,
  size = 46,
  onUpdate,
}: StudentPhotoEditorProps) {
  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [currentUrl, setCurrentUrl] = useState<string | null>(photoUrl ?? null);
  const [failed, setFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // currentUrl 이 /avatars/kids/.. 이면 '직접 고른 기본 얼굴', 비어있으면 'ID 자동 기본 얼굴'.
  const storedDefault = isKidDefaultFace(currentUrl);
  const defaultFace = storedDefault ? currentUrl! : kidDefaultFace(gender, studentId);
  const faceChoices = kidFaceChoices(gender);

  useEffect(() => { setCurrentUrl(photoUrl ?? null); setFailed(false); }, [photoUrl]);

  // === 크롭 상태 ===
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  // 실제 등록 사진 여부(기본 얼굴 일러스트는 사진 아님). 사진이면 + 배지를 숨긴다.
  const showPhoto = !!currentUrl && !failed && !storedDefault;
  const displaySrc = showPhoto ? currentUrl! : defaultFace;
  const displayTransform = showPhoto ? "" : kidFaceTransform(defaultFace);

  const openModal = () => { setShowModal(true); setError(""); };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("파일 크기는 10MB 이하만 가능합니다"); return; }
    if (!file.type.startsWith("image/")) { setError("이미지 파일만 업로드 가능합니다"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
      setError("");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const getCroppedBlob = async (imageSrc: string, pixelCrop: Area, target = 512): Promise<Blob | null> => {
    const image = await createImage(imageSrc);
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, target, target);
    return new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
  };

  const handleCropConfirm = async () => {
    if (!cropImageSrc || !croppedAreaPixels) return;
    if (!memberId) { setError("연결된 성도 정보가 없어 사진을 저장할 수 없습니다"); return; }
    setUploading(true);
    setError("");
    try {
      const blob = await getCroppedBlob(cropImageSrc, croppedAreaPixels, 512);
      if (!blob) { setError("이미지 처리 실패"); setUploading(false); return; }

      const path = `${memberId}/student_${Date.now()}.jpg`;
      const form = new FormData();
      form.append("file", new File([blob], "student.jpg", { type: "image/jpeg" }));
      const uploadRes = await fetch(`/api/storage/member-photos/${path}`, { method: "POST", body: form });
      const uploadResult = await uploadRes.json();
      if (!uploadResult.ok) { setError(`업로드 실패: ${uploadResult.error ?? "오류"}`); setUploading(false); return; }

      const publicUrl = `/api/storage/member-photos/${path}?t=${Date.now()}`;
      const { error: rpcError } = await supabase.rpc("edu_set_student_photo", {
        p_dept_id: deptId,
        p_student_id: studentId,
        p_photo_url: publicUrl,
      });
      if (rpcError) { setError(`저장 실패: ${rpcError.message}`); setUploading(false); return; }

      setCurrentUrl(publicUrl);
      setFailed(false);
      onUpdate?.(publicUrl);
      setUploading(false);
      setCropImageSrc(null);
      setShowModal(false);
    } catch (err) {
      setError(`오류: ${(err as Error).message}`);
      setUploading(false);
    }
  };

  const handleRevert = async () => {
    if (!memberId) return;
    setUploading(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("edu_set_student_photo", {
      p_dept_id: deptId,
      p_student_id: studentId,
      p_photo_url: null,
    });
    setUploading(false);
    if (rpcError) { setError(`처리 실패: ${rpcError.message}`); return; }
    setCurrentUrl(null);
    setFailed(false);
    onUpdate?.(null);
    setShowModal(false);
  };

  // 기본 얼굴 일러스트 선택 → members.photo_url 에 경로 저장(사진 아님, + 배지 유지).
  const handlePickDefault = async (face: string) => {
    if (!memberId) { setError("연결된 성도 정보가 없어 저장할 수 없습니다"); return; }
    if (face === currentUrl) { setShowModal(false); return; }
    setUploading(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("edu_set_student_photo", {
      p_dept_id: deptId,
      p_student_id: studentId,
      p_photo_url: face,
    });
    setUploading(false);
    if (rpcError) { setError(`저장 실패: ${rpcError.message}`); return; }
    setCurrentUrl(face);
    setFailed(false);
    onUpdate?.(face);
    setShowModal(false);
  };

  return (
    <>
      {/* === 아바타 (클릭 → 편집) === */}
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <button
          type="button"
          onClick={openModal}
          aria-label={`${name} 사진 변경`}
          className="kid-avatar group relative grid place-items-center overflow-hidden p-0"
          style={{
            width: size,
            height: size,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--accent-muted) 14%, #f7f2e8)",
            border: "1px solid var(--hairline)",
            cursor: "pointer",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displaySrc}
            alt={showPhoto ? `${name} 프로필 사진` : `${name} 기본 프로필`}
            loading="lazy"
            decoding="async"
            onError={() => { if (showPhoto) setFailed(true); }}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", transform: displayTransform || undefined }}
          />
          <span
            className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100"
            style={{ background: "rgba(0,0,0,0.4)" }}
          >
            <Camera size={size * 0.4} strokeWidth={2} color="#fff" />
          </span>
        </button>

        {/* 기본 얼굴일 때만 + 배지: '사진 등록 가능' 안내. 사진 등록되면 사라짐 */}
        {!showPhoto && (
          <span
            aria-hidden
            className="pointer-events-none absolute grid place-items-center"
            style={{
              right: -1,
              bottom: -1,
              width: Math.max(15, Math.round(size * 0.34)),
              height: Math.max(15, Math.round(size * 0.34)),
              borderRadius: 999,
              background: "var(--accent)",
              border: "1.5px solid var(--card)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }}
          >
            <Plus size={Math.max(9, Math.round(size * 0.2))} strokeWidth={3} color="#fff" />
          </span>
        )}
      </span>

      {/* === 메인 모달 === */}
      {showModal && !cropImageSrc && (
        <div onClick={() => !uploading && setShowModal(false)} style={overlayStyle}>
          <div onClick={(e) => e.stopPropagation()} style={cardStyle}>
            <div style={titleStyle}>
              <Camera size={20} strokeWidth={1.8} /> {name} 사진
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <div style={{ width: 180, height: 180, borderRadius: 999, overflow: "hidden", border: "3px solid var(--hairline)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", background: "color-mix(in srgb, var(--accent-muted) 14%, #f7f2e8)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displaySrc}
                  alt={`${name} 사진`}
                  style={{ width: "100%", height: "100%", objectFit: "cover", transform: displayTransform || undefined }}
                />
              </div>
            </div>

            {!showPhoto && (
              <div style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center", marginBottom: 12, fontWeight: 600 }}>
                기본 얼굴을 표시 중입니다
              </div>
            )}

            {/* === 기본 얼굴 고르기 === */}
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-mid)", marginBottom: 8 }}>기본 얼굴 고르기</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 8,
                marginBottom: 16,
                maxHeight: 200,
                overflowY: "auto",
                padding: 2,
              }}
            >
              {faceChoices.map((face) => {
                const active = face === defaultFace && !showPhoto;
                return (
                  <button
                    key={face}
                    type="button"
                    onClick={() => handlePickDefault(face)}
                    disabled={!memberId || uploading}
                    aria-label="기본 얼굴 선택"
                    className="relative grid place-items-center overflow-hidden p-0"
                    style={{
                      aspectRatio: "1",
                      borderRadius: 999,
                      background: "color-mix(in srgb, var(--accent-muted) 14%, #f7f2e8)",
                      border: active ? "2.5px solid var(--accent)" : "1px solid var(--hairline)",
                      cursor: memberId && !uploading ? "pointer" : "not-allowed",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={face}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={{ width: "100%", height: "100%", objectFit: "cover", transform: kidFaceTransform(face) || undefined }}
                    />
                    {active && (
                      <span
                        className="pointer-events-none absolute grid place-items-center"
                        style={{ right: 1, bottom: 1, width: 16, height: 16, borderRadius: 999, background: "var(--accent)", border: "1.5px solid var(--card)" }}
                      >
                        <Check size={9} strokeWidth={3.5} color="#fff" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {!memberId && (
              <div style={{ ...noticeStyle }}>
                <AlertTriangle size={14} strokeWidth={1.8} /> 연결된 성도 정보가 없어 사진을 저장할 수 없습니다
              </div>
            )}
            {error && <div style={errorStyle}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>}

            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowModal(false)} style={btnSecondary}>닫기</button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!memberId}
                style={{ ...btnPrimary, ...(memberId ? {} : { background: "var(--hairline-strong)", boxShadow: "none", cursor: "not-allowed" }) }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Camera size={15} strokeWidth={1.8} /> {showPhoto ? "사진 변경" : "사진 등록"}
                </span>
              </button>
            </div>

            {showPhoto && (
              <button onClick={handleRevert} disabled={uploading} style={btnRevert}>
                <Undo2 size={14} strokeWidth={1.8} /> 기본 얼굴로 되돌리기
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
        <div style={overlayStyle}>
          <div style={{ ...cardStyle, maxWidth: 480, padding: "20px 16px" }}>
            <div style={titleStyle}><CropIcon size={20} strokeWidth={1.8} /> 영역 선택</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", textAlign: "center", marginBottom: 14, lineHeight: 1.5 }}>
              드래그로 위치 조정 · 슬라이더로 확대 (얼굴이 잘 보이도록)
            </div>
            <div style={{ position: "relative", width: "100%", aspectRatio: "1", background: "#000", borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
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
              <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ width: "100%", accentColor: "var(--accent)" }} />
            </div>
            {error && <div style={errorStyle}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setCropImageSrc(null)} disabled={uploading} style={btnSecondary}>다시 선택</button>
              <button onClick={handleCropConfirm} disabled={uploading} style={{ ...btnPrimary, background: uploading ? "var(--ink-faint)" : "linear-gradient(135deg, var(--success), var(--success))" }}>
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

const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 };
const cardStyle: React.CSSProperties = { background: "var(--card)", borderRadius: 20, padding: "24px 20px", maxWidth: 380, width: "100%", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", fontFamily: "'Noto Sans KR', sans-serif" };
const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 14, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 };
const errorStyle: React.CSSProperties = { padding: "10px 14px", background: "var(--danger-soft)", border: "1px solid var(--danger-soft)", borderRadius: 10, fontSize: 12, color: "var(--danger)", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 };
const noticeStyle: React.CSSProperties = { padding: "10px 14px", background: "var(--warning-soft)", border: "1px solid color-mix(in srgb, var(--warning) 26%, transparent)", borderRadius: 10, fontSize: 12, color: "var(--ink-mid)", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 };
const btnSecondary: React.CSSProperties = { flex: 1, padding: "12px", background: "var(--bg-soft)", color: "var(--ink-soft)", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { flex: 1.5, padding: "12px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 6px 16px rgba(62, 90, 74, 0.3)" };
const btnRevert: React.CSSProperties = { width: "100%", marginTop: 8, padding: "11px", background: "var(--card)", color: "var(--ink-soft)", border: "1px solid var(--hairline-strong)", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 };
