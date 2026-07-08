import { supabase } from "@/lib/supabase";

export async function saveStudentPendingPhoto({
  deptId,
  studentId,
  memberId,
  avatarUrl,
  file,
}: {
  deptId: string;
  studentId: string;
  memberId?: string | null;
  avatarUrl?: string | null;
  file?: File | null;
}) {
  let photoUrl = avatarUrl || null;

  if (file) {
    const ownerPath = memberId || `students/${studentId}`;
    const ext = extensionFromFile(file);
    const path = `${ownerPath}/student_${Date.now()}.${ext}`;
    const form = new FormData();
    form.append("file", file);
    const uploadRes = await fetch(`/api/storage/member-photos/${path}`, { method: "POST", body: form });
    const uploadResult = await uploadRes.json();
    if (!uploadResult.ok) throw new Error(uploadResult.error || "사진 업로드에 실패했습니다");
    photoUrl = `/api/storage/member-photos/${path}?t=${Date.now()}`;
  }

  if (!photoUrl) return null;

  const { error } = await supabase.rpc("edu_set_student_photo", {
    p_dept_id: deptId,
    p_student_id: studentId,
    p_photo_url: photoUrl,
  });
  if (error) throw error;
  return photoUrl;
}

function extensionFromFile(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}
