"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase, formatPhone } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Sparkles, User } from "lucide-react";

interface FriendSummary {
  id: string;
  name: string;
  gender: string | null;
  birth_date: string | null;
  mobile: string | null;
  join_date: string | null;
  guide_name: string | null;
  created_at: string;
}

interface FriendDetail extends FriendSummary {
  department_id: string;
  photo_url: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  group_pa: string | null;
  group_jik: string | null;
  group_gun: string | null;
  group_cheo: string | null;
  family_name: string | null;
  school_district: string | null;
  special_notes: string | null;
  memo: string | null;
}

const EMPTY_FORM: Omit<FriendDetail, "id" | "department_id" | "created_at"> = {
  name: "", gender: null, birth_date: null, photo_url: null,
  phone: "", mobile: "", address: "", email: "",
  group_pa: "", group_jik: "", group_gun: "", group_cheo: "",
  family_name: "", guide_name: "", school_district: "", join_date: null,
  special_notes: "", memo: "",
};

export default function NewFriendPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [selected, setSelected] = useState<FriendDetail | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM });
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await loadList();
    })();
  }, []);

  const loadList = async () => {
    setLoading(true);
    const { data } = await supabase.rpc("edu_list_new_friends", { p_dept_id: deptId });
    setFriends(data || []);
    setLoading(false);
  };

  const selectFriend = async (id: string) => {
    const { data } = await supabase.rpc("edu_get_new_friend", { p_id: id });
    if (data && data[0]) {
      const f = data[0];
      setSelected(f);
      setForm({
        name: f.name || "", gender: f.gender, birth_date: f.birth_date,
        photo_url: f.photo_url, phone: f.phone || "", mobile: f.mobile || "",
        address: f.address || "", email: f.email || "",
        group_pa: f.group_pa || "", group_jik: f.group_jik || "",
        group_gun: f.group_gun || "", group_cheo: f.group_cheo || "",
        family_name: f.family_name || "", guide_name: f.guide_name || "",
        school_district: f.school_district || "", join_date: f.join_date,
        special_notes: f.special_notes || "", memo: f.memo || "",
      });
      setIsNew(false);
    }
  };

  const newFriend = () => {
    setSelected(null);
    setForm({ ...EMPTY_FORM });
    setIsNew(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast("이름을 입력하세요"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("edu_save_new_friend", {
        p_id:          isNew ? null : selected?.id,
        p_dept_id:     deptId,
        p_name:        form.name,
        p_gender:      form.gender,
        p_birth_date:  form.birth_date,
        p_phone:       form.phone,
        p_mobile:      form.mobile,
        p_address:     form.address,
        p_email:       form.email,
        p_group_pa:    form.group_pa,
        p_group_jik:   form.group_jik,
        p_group_gun:   form.group_gun,
        p_group_cheo:  form.group_cheo,
        p_family_name: form.family_name,
        p_guide_name:  form.guide_name,
        p_school_dist: form.school_district,
        p_join_date:   form.join_date,
        p_special:     form.special_notes,
        p_memo:        form.memo,
      });
      if (error) throw error;
      showToast("저장되었습니다");
      await loadList();
      setIsNew(false);
    } catch (e: unknown) {
      showToast("오류: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`"${selected.name}"을(를) 삭제하시겠습니까?`)) return;
    await supabase.rpc("edu_delete_new_friend", { p_id: selected.id });
    showToast("삭제되었습니다");
    setSelected(null);
    setIsNew(false);
    await loadList();
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const f = (key: keyof typeof form) => (form[key] as string) ?? "";
  const set = (key: keyof typeof form, val: string | null) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const filtered = friends.filter((fr) =>
    fr.name.includes(search) || (fr.guide_name ?? "").includes(search)
  );

  if (!authChecked) return <LoadingView full />;

  const showForm = isNew || selected;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>

      {/* Header */}
      <div style={headerStyle}>
        <HeaderLogo />
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><Sparkles size={18} strokeWidth={1.8} style={{ color: "var(--accent)" }} /> 새친구 등록카드</div>
        <button onClick={newFriend} style={addBtnStyle}>+ 새 등록</button>
      </div>

      <div className="mx-auto grid max-w-[1200px] gap-4 p-4 md:grid-cols-[260px_1fr]">
        {/* 목록 패널 */}
        <div>
          <div style={cardStyle}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름 / 인도자 검색"
              style={{ ...inputStyle, width: "100%", marginBottom: 12, boxSizing: "border-box" }}
            />
            <div style={{ fontSize: 10, color: "var(--ink-faint)", marginBottom: 8 }}>
              총 {filtered.length}명
            </div>
            {loading ? (
              <LoadingView padding={12} label="불러오는 중..." />
            ) : filtered.length === 0 ? (
              <div style={{ color: "var(--ink-faint)", fontSize: 12, padding: 12 }}>등록된 새친구가 없습니다</div>
            ) : (
              filtered.map((fr) => (
                <div
                  key={fr.id}
                  onClick={() => selectFriend(fr.id)}
                  style={{
                    padding: "12px",
                    borderRadius: 10,
                    marginBottom: 6,
                    cursor: "pointer",
                    background: selected?.id === fr.id ? "var(--accent-soft)" : "var(--surface)",
                    border: selected?.id === fr.id ? "1.5px solid var(--accent)" : "1.5px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: fr.gender === "남" ? "var(--accent-soft)" : fr.gender === "여" ? "#F5E5EB" : "var(--bg-soft)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, flexShrink: 0,
                    }}>
                      <User size={18} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{fr.name}</div>
                      {fr.guide_name && (
                        <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>인도자: {fr.guide_name}</div>
                      )}
                      {fr.join_date && (
                        <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>{fr.join_date.slice(0, 7)}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 등록카드 폼 */}
        <div>
          {!showForm ? (
            <div style={{ ...cardStyle, padding: 24 }}>
              <EmptyState
                icon={<Sparkles size={24} strokeWidth={1.6} />}
                message="왼쪽에서 새친구를 선택하거나 새 등록 버튼을 눌러 카드를 작성하세요"
              />
            </div>
          ) : (
            <div style={cardStyle}>
              {/* 카드 헤더 */}
              <div style={{
                background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
                borderRadius: 12,
                padding: "20px 24px",
                marginBottom: 20,
                color: "#fff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 4 }}>새친구 등록카드</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {form.name || "이름 미입력"}
                  </div>
                  {form.gender && (
                    <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{form.gender} · {form.join_date ?? "가입일 미정"}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!isNew && (
                    <button onClick={handleDelete} style={deleteBtnStyle}>삭제</button>
                  )}
                  <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>

              {/* 폼 그리드 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="이름 *">
                  <input type="text" value={f("name")} onChange={(e) => set("name", e.target.value)} placeholder="이름" style={inputStyle} />
                </FormField>

                <FormField label="성별">
                  <div style={{ display: "flex", gap: 8 }}>
                    {["남", "여"].map((g) => (
                      <button
                        key={g}
                        onClick={() => set("gender", form.gender === g ? null : g)}
                        style={{
                          flex: 1, padding: "9px", borderRadius: 8, border: "1.5px solid",
                          borderColor: form.gender === g ? "var(--accent)" : "var(--hairline)",
                          background: form.gender === g ? "var(--accent-soft)" : "#fff",
                          color: form.gender === g ? "var(--accent)" : "var(--ink-soft)",
                          fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >{g}</button>
                    ))}
                  </div>
                </FormField>

                <FormField label="생년월일">
                  <input type="date" value={f("birth_date")} onChange={(e) => set("birth_date", e.target.value || null)} style={inputStyle} />
                </FormField>

                <FormField label="교회가입일">
                  <input type="date" value={f("join_date")} onChange={(e) => set("join_date", e.target.value || null)} style={inputStyle} />
                </FormField>

                <FormField label="전화">
                  <input type="tel" value={f("phone")} onChange={(e) => set("phone", formatPhone(e.target.value))} placeholder="전화번호" style={inputStyle} />
                </FormField>

                <FormField label="핸드폰">
                  <input type="tel" value={f("mobile")} onChange={(e) => set("mobile", formatPhone(e.target.value))} placeholder="핸드폰 번호" style={inputStyle} />
                </FormField>

                <FormField label="Email" fullWidth>
                  <input type="email" value={f("email")} onChange={(e) => set("email", e.target.value)} placeholder="이메일 주소" style={inputStyle} />
                </FormField>

                <FormField label="주소" fullWidth>
                  <input type="text" value={f("address")} onChange={(e) => set("address", e.target.value)} placeholder="주소" style={inputStyle} />
                </FormField>

                {/* 소속 */}
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 8 }}>소속</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {[
                      { key: "group_pa",   label: "파" },
                      { key: "group_jik",  label: "직" },
                      { key: "group_gun",  label: "군" },
                      { key: "group_cheo", label: "처" },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <div style={{ fontSize: 10, color: "var(--ink-faint)", marginBottom: 3 }}>{label}</div>
                        <input type="text" value={f(key as keyof typeof form)} onChange={(e) => set(key as keyof typeof form, e.target.value)} style={inputStyle} />
                      </div>
                    ))}
                  </div>
                </div>

                <FormField label="가족이름">
                  <input type="text" value={f("family_name")} onChange={(e) => set("family_name", e.target.value)} placeholder="가족 이름" style={inputStyle} />
                </FormField>

                <FormField label="인도자">
                  <input type="text" value={f("guide_name")} onChange={(e) => set("guide_name", e.target.value)} placeholder="인도자 이름" style={inputStyle} />
                </FormField>

                <FormField label="학원구">
                  <input type="text" value={f("school_district")} onChange={(e) => set("school_district", e.target.value)} placeholder="학원구" style={inputStyle} />
                </FormField>

                <FormField label="특기사항" fullWidth>
                  <textarea value={f("special_notes")} onChange={(e) => set("special_notes", e.target.value)} placeholder="특기사항" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                </FormField>

                <FormField label="Memo" fullWidth>
                  <textarea value={f("memo")} onChange={(e) => set("memo", e.target.value)} placeholder="메모" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                </FormField>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function FormField({ label, children, fullWidth }: { label: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div style={{ gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const cardStyle: React.CSSProperties = { background: "var(--card)", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1.5px solid var(--hairline)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", flexShrink: 0,
};
const addBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const saveBtnStyle: React.CSSProperties = { padding: "8px 16px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "1.5px solid rgba(255,255,255,0.5)", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const deleteBtnStyle: React.CSSProperties = { padding: "8px 12px", background: "rgba(168, 68, 60,0.2)", color: "#fff", border: "1px solid rgba(168, 68, 60,0.4)", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const toastStyle: React.CSSProperties = { position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap" };
