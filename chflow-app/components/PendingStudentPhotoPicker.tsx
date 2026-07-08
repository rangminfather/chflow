"use client";

import { useRef } from "react";
import { Camera, Check, Upload } from "lucide-react";
import { kidDefaultFace, kidFaceChoices, kidFaceTransform } from "@/lib/kidAvatar";

interface PendingStudentPhotoPickerProps {
  name: string;
  gender: string | null | undefined;
  seed: string;
  photoUrl: string | null;
  previewUrl: string | null;
  onAvatar: (url: string) => void;
  onFile: (file: File, previewUrl: string) => void;
}

export default function PendingStudentPhotoPicker({
  name,
  gender,
  seed,
  photoUrl,
  previewUrl,
  onAvatar,
  onFile,
}: PendingStudentPhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const defaultFace = photoUrl || kidDefaultFace(gender, seed);
  const displayUrl = previewUrl || defaultFace;
  const faces = kidFaceChoices(gender);

  function pickFile(file: File | null) {
    if (!file || !file.type.startsWith("image/")) return;
    onFile(file, URL.createObjectURL(file));
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface p-3">
      <div className="mb-2 flex items-center gap-2 text-[14px] font-extrabold text-ink">
        <Camera size={15} strokeWidth={2.1} /> 프로필 얼굴
      </div>
      <div className="flex items-center gap-3">
        <div className="h-20 w-20 overflow-hidden rounded-full border border-hairline bg-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl}
            alt={`${name || "학생"} 프로필`}
            className="h-full w-full object-cover"
            style={{ transform: previewUrl ? undefined : kidFaceTransform(defaultFace) || undefined }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-ink px-3 text-[13px] font-extrabold text-white"
          >
            <Upload size={14} strokeWidth={2.2} /> 사진 업로드
          </button>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => pickFile(event.target.files?.[0] || null)} />
          <div className="mt-1 text-[11px] font-semibold text-ink-faint">사진을 고르거나 아래 기본 아바타를 선택하세요.</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-8 gap-1.5">
        {faces.map((face) => {
          const active = !previewUrl && photoUrl === face;
          return (
            <button
              key={face}
              type="button"
              onClick={() => onAvatar(face)}
              className="relative aspect-square overflow-hidden rounded-full border bg-card"
              style={{ borderColor: active ? "var(--accent)" : "var(--hairline)", borderWidth: active ? 2 : 1 }}
              aria-label="기본 아바타 선택"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={face} alt="" className="h-full w-full object-cover" style={{ transform: kidFaceTransform(face) || undefined }} />
              {active && (
                <span className="absolute bottom-0 right-0 grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-white">
                  <Check size={9} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
