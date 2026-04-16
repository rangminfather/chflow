"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Props {
  memberId: string;
  onClose: () => void;
  onChanged?: () => void;
}

interface ProfileData {
  member: any;
  household_members: any[] | null;
  relations: any[] | null;
  descendants: any[] | null;
}

const ROLE_LABELS: Record<string, string> = {
  father: "아버지", mother: "어머니",
  grandfather: "할아버지", grandmother: "할머니",
  paternal_grandfather: "친할아버지", paternal_grandmother: "친할머니",
  maternal_grandfather: "외할아버지", maternal_grandmother: "외할머니",
  great_grandfather: "증조부", great_grandmother: "증조모",
  husband: "남편", wife: "아내",
  brother: "형제", sister: "자매",
};

export default function MemberCardModal({ memberId, onClose, onChanged }: Props) {
  const router = useRouter();
  // 성도 카드 내부 네비게이션 히스토리 (마지막 원소 = 현재 보는 member)
  const [stack, setStack] = useState<string[]>([memberId]);
  const currentId = stack[stack.length - 1];

  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<any>({});
  const [uploading, setUploading] = useState(false);
  const [showRelAdd, setShowRelAdd] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const navigateTo = async (targetId: string, candidateName?: string, isChildDummy?: boolean) => {
    // 자녀 더미(= is_child=true, 본인 카드가 아님) 클릭 시 동명 성인 있으면 그쪽으로 우선
    if (isChildDummy && candidateName) {
      const { data: cands } = await supabase.rpc("search_member_candidates", {
        p_name: candidateName, p_phone: null, p_limit: 10,
      });
      const adults = (cands || []).filter((c: any) => !c.is_child);
      if (adults.length === 1) { setStack(prev => [...prev, adults[0].id]); return; }
      if (adults.length > 1) {
        // 여러 명이면 그 중 전화번호/가족 힌트 없으니 첫 번째로. 필요시 선택 UI 확장.
        setStack(prev => [...prev, adults[0].id]); return;
      }
      // 성인 버전 없으면 자녀 더미 그대로
    }
    setStack(prev => [...prev, targetId]);
  };
  const goBack = () => setStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_member_profile", { p_member_id: currentId });
    if (!error && data) {
      setData(data);
      setEdit(data.member);
    }
    setLoading(false);
    setEditing(false);
  };

  useEffect(() => { load(); }, [currentId]);

  const goToPasture = () => {
    if (!data?.member?.pasture_name) return;
    const pn = encodeURIComponent(data.member.pasture_name);
    const pl = data.member.plain_name ? `&plain=${encodeURIComponent(data.member.plain_name)}` : "";
    const gr = data.member.grassland_name ? `&grassland=${encodeURIComponent(data.member.grassland_name)}` : "";
    router.push(`/admin/members?pasture=${pn}${pl}${gr}`);
    onClose();
  };

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${currentId}/profile.${ext}`;
      const { error: upErr } = await supabase.storage.from("member-photos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) { alert(`업로드 실패: ${upErr.message}`); return; }
      const { data: { publicUrl } } = supabase.storage.from("member-photos").getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      const { error: rpcErr } = await supabase.rpc("admin_set_member_photo", { p_member_id: currentId, p_photo_url: url });
      if (rpcErr) { alert(`저장 실패: ${rpcErr.message}`); return; }
      await load();
      onChanged?.();
    } finally {
      setUploading(false);
    }
  };

  const handleSaveEdit = async () => {
    const { error } = await supabase.rpc("admin_update_member", {
      p_member_id: currentId,
      p_name: edit.name, p_phone: edit.phone,
      p_family_church: edit.family_church, p_sub_role: edit.sub_role,
      p_spouse_name: edit.spouse_name,
      p_gender: edit.gender || null, p_is_child: edit.is_child,
    });
    if (error) { alert(`수정 실패: ${error.message}`); return; }
    setEditing(false);
    await load();
    onChanged?.();
  };

  const handleRemoveRelation = async (relativeId: string, kind: string, direction: string) => {
    if (!confirm("이 관계를 제거하시겠습니까?")) return;
    const subject = direction === "descendant" ? relativeId : currentId;
    const relative = direction === "descendant" ? currentId : relativeId;
    const { error } = await supabase.rpc("remove_member_relation", {
      p_subject_id: subject, p_relative_id: relative, p_kind: kind,
    });
    if (error) { alert(`제거 실패: ${error.message}`); return; }
    await load();
  };

  if (loading || !data) {
    return (
      <div onClick={onClose} style={bgStyle}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 40 }}>로딩 중...</div>
      </div>
    );
  }

  const m = data.member;
  const photoUrl = m.photo_url;
  const genderColor = m.gender === "M" ? "#3b82f6" : m.gender === "F" ? "#ec4899" : "#64748b";

  return (
    <div onClick={onClose} style={bgStyle}>
      <div onClick={(e) => e.stopPropagation()} style={cardStyle}>
        {/* 헤더 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {stack.length > 1 && (
              <button onClick={goBack} title="이전 카드"
                style={{ width: 28, height: 28, borderRadius: 8, background: "#f1f5f9", border: "none", fontSize: 14, cursor: "pointer", color: "#475569", fontFamily: "inherit" }}>←</button>
            )}
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>성도 카드</div>
            {stack.length > 1 && (
              <span style={{ fontSize: 10, color: "#94a3b8", padding: "2px 8px", background: "#f1f5f9", borderRadius: 10 }}>
                {stack.length}단계 깊이
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#64748b" }}>×</button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {/* 큰 사진 + 기본 정보 */}
          <div style={{ display: "flex", gap: 18, marginBottom: 20, alignItems: "flex-start" }}>
            <div style={{ position: "relative" }}>
              <div style={{
                width: 140, height: 140, borderRadius: 18, overflow: "hidden",
                background: "#f1f5f9", border: `3px solid ${genderColor}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {photoUrl
                  ? <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ fontSize: 56, color: "#cbd5e1" }}>{m.gender === "F" ? "👩" : "👨"}</div>}
              </div>
              <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
                position: "absolute", bottom: -6, right: -6, width: 38, height: 38, borderRadius: "50%",
                background: "#6366f1", color: "#fff", border: "3px solid #fff", fontSize: 14,
                cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              }} title="사진 변경">{uploading ? "…" : "📷"}</button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); }} />
            </div>

            <div style={{ flex: 1 }}>
              {editing ? (
                <>
                  <input value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={editInputLg} />
                  <input value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="휴대폰" style={editInput} />
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <select value={edit.gender || ""} onChange={(e) => setEdit({ ...edit, gender: e.target.value || null })} style={{ ...editInput, flex: 1 }}>
                      <option value="">성별</option><option value="M">남</option><option value="F">여</option>
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#475569", paddingLeft: 6 }}>
                      <input type="checkbox" checked={!!edit.is_child} onChange={(e) => setEdit({ ...edit, is_child: e.target.checked })} />
                      자녀
                    </label>
                  </div>
                  <input value={edit.family_church || ""} onChange={(e) => setEdit({ ...edit, family_church: e.target.value })} placeholder="가정교회 (목자/목녀/목원)" style={editInput} />
                  <input value={edit.sub_role || ""} onChange={(e) => setEdit({ ...edit, sub_role: e.target.value })} placeholder="직분" style={editInput} />
                  <input value={edit.spouse_name || ""} onChange={(e) => setEdit({ ...edit, spouse_name: e.target.value })} placeholder="배우자" style={editInput} />
                </>
              ) : (
                <>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#1e293b", marginBottom: 4 }}>
                    {m.name}
                    {m.gender && <span style={{ fontSize: 12, color: genderColor, marginLeft: 8 }}>{m.gender === "M" ? "♂ 남" : "♀ 여"}</span>}
                    {m.is_child && <span style={{ fontSize: 12, color: "#f59e0b", marginLeft: 8 }}>👶 자녀</span>}
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>
                    {m.sub_role || "직분 미지정"} · {m.family_church || "목원"}
                    {m.spouse_name && ` · 배우자 ${m.spouse_name}`}
                  </div>
                  <div style={{ fontSize: 13, color: "#475569", marginBottom: 2 }}>📞 {m.phone || "연락처 없음"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      📍 {m.plain_name ? `${m.plain_name}평원 · ${m.grassland_name}초원 · ` : ""}<strong>{m.pasture_name || "소속 없음"}</strong> 목장
                    </div>
                    {m.pasture_name && (
                      <button onClick={goToPasture} title="이 목장 전체 회원 보기"
                        style={{ fontSize: 10, padding: "2px 8px", background: "#e0e7ff", color: "#4338ca", border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
                        목장 전체 →
                      </button>
                    )}
                  </div>
                  {m.address && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>🏠 {m.address}</div>}
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {editing ? (
              <>
                <button onClick={() => { setEdit(m); setEditing(false); }} style={btnGhost}>취소</button>
                <button onClick={handleSaveEdit} style={btnPrimary}>저장</button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} style={btnPrimary}>✏️ 정보 수정</button>
            )}
          </div>

          {/* 같은 가족 */}
          {data.household_members && data.household_members.length > 0 && (
            <Section title={`👨‍👩‍👧 같은 가족 (${data.household_members.length})`}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {data.household_members.map((hm: any) => (
                  <MemberChip key={hm.id} name={hm.name} photoUrl={hm.photo_url}
                    subtitle={hm.is_child ? "자녀" : (hm.sub_role || hm.family_church)}
                    onClick={() => navigateTo(hm.id, hm.name, hm.is_child)} />
                ))}
              </div>
              {data.household_members.some((hm: any) => hm.is_child) && (
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>
                  💡 자녀를 클릭하면 같은 이름의 성인 성도가 있을 경우 그 성도 카드로 이동합니다.
                </div>
              )}
            </Section>
          )}

          {/* 부모/조상 */}
          <Section title="👴 부모·조부모" action={
            <button onClick={() => setShowRelAdd(true)} style={btnMiniPrimary}>+ 추가</button>
          }>
            {data.relations && data.relations.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.relations.map((r: any, i: number) => (
                  <RelationRow key={i} relation={r}
                    onClick={() => navigateTo(r.relative_id)}
                    onRemove={() => handleRemoveRelation(r.relative_id, r.kind, "ancestor")} />
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0" }}>등록된 부모·조부모가 없습니다</div>
            )}
          </Section>

          {/* 자녀/후손 */}
          <Section title="👶 자녀·손주">
            {data.descendants && data.descendants.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.descendants.map((r: any, i: number) => (
                  <RelationRow key={i} relation={r} reversed
                    onClick={() => navigateTo(r.relative_id)}
                    onRemove={() => handleRemoveRelation(r.relative_id, r.kind, "descendant")} />
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 0" }}>등록된 자녀·손주가 없습니다</div>
            )}
          </Section>
        </div>
      </div>

      {/* 관계 추가 모달 */}
      {showRelAdd && (
        <RelationAddModal subjectId={currentId} onClose={() => setShowRelAdd(false)}
          onAdded={() => { setShowRelAdd(false); load(); }} />
      )}
    </div>
  );
}


// ============ Subcomponents ============
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function MemberChip({ name, photoUrl, subtitle, onClick }: { name: string; photoUrl?: string | null; subtitle?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 4px",
        background: "#fff", borderRadius: 20, border: "1px solid #e2e8f0",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s",
      }}
      onMouseOver={(e) => { if (onClick) { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.background = "#eef2ff"; } }}
      onMouseOut={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", background: "#e2e8f0", flexShrink: 0 }}>
        {photoUrl && <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>{name}</div>
        {subtitle && <div style={{ fontSize: 9, color: "#94a3b8" }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function RelationRow({ relation, reversed, onRemove, onClick }: { relation: any; reversed?: boolean; onRemove: () => void; onClick?: () => void }) {
  const roleLabel = ROLE_LABELS[relation.role] || relation.role || relation.kind;
  return (
    <div onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
        background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s",
      }}
      onMouseOver={(e) => { if (onClick) { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.background = "#eef2ff"; } }}
      onMouseOut={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", background: "#e2e8f0", flexShrink: 0 }}>
        {relation.photo_url && <img src={relation.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
          {relation.name}
          <span style={{ fontSize: 10, marginLeft: 6, padding: "1px 6px", background: reversed ? "#fef3c7" : "#dbeafe", color: reversed ? "#92400e" : "#1e40af", borderRadius: 4 }}>
            {reversed ? `나의 ${kindReverseLabel(relation.kind, relation.role)}` : roleLabel}
          </span>
        </div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
          {relation.phone || "연락처 없음"} · {relation.plain_name ? `${relation.plain_name}평원 · ` : ""}{relation.pasture_name || "소속 없음"} 목장
        </div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{ padding: "4px 8px", background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>제거</button>
    </div>
  );
}

function kindReverseLabel(kind: string, role: string | null): string {
  if (kind === "parent") return role === "father" || role === "mother" ? "자녀" : "자녀";
  if (kind === "grandparent") return "손주";
  if (kind === "spouse") return role === "husband" ? "아내" : role === "wife" ? "남편" : "배우자";
  return "관계";
}


// ============ Relation Add Modal ============
function RelationAddModal({ subjectId, onClose, onAdded }: {
  subjectId: string; onClose: () => void; onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [candidates, setCandidates] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [kind, setKind] = useState<string>("parent");
  const [role, setRole] = useState<string>("father");

  const search = async () => {
    if (!name.trim()) return;
    setSearching(true);
    const { data } = await supabase.rpc("search_member_candidates", {
      p_name: name.trim(), p_phone: phone || null, p_limit: 10,
    });
    setCandidates(data || []);
    setSearching(false);
  };

  useEffect(() => {
    if (!selected) return;
    // 기본 role 추천
    (async () => {
      const { data } = await supabase.rpc("suggest_relation_role", {
        p_subject_id: subjectId, p_relative_id: selected.id,
      });
      if (data && data[0]) { setKind(data[0].kind); setRole(data[0].role || ""); }
    })();
  }, [selected, subjectId]);

  const submit = async () => {
    if (!selected) return;
    const { error } = await supabase.rpc("add_member_relation", {
      p_subject_id: subjectId, p_relative_id: selected.id,
      p_kind: kind, p_role: role || null,
    });
    if (error) { alert(`추가 실패: ${error.message}`); return; }
    onAdded();
  };

  const KIND_OPTIONS = [
    { value: "parent", label: "부모" },
    { value: "grandparent", label: "조부모" },
    { value: "great_grandparent", label: "증조부모" },
    { value: "spouse", label: "배우자" },
    { value: "sibling", label: "형제자매" },
  ];
  const ROLE_OPTIONS: Record<string, { value: string; label: string }[]> = {
    parent: [
      { value: "father", label: "아버지" },
      { value: "mother", label: "어머니" },
    ],
    grandparent: [
      { value: "paternal_grandfather", label: "친할아버지" },
      { value: "paternal_grandmother", label: "친할머니" },
      { value: "maternal_grandfather", label: "외할아버지" },
      { value: "maternal_grandmother", label: "외할머니" },
      { value: "grandfather", label: "할아버지" },
      { value: "grandmother", label: "할머니" },
    ],
    great_grandparent: [
      { value: "great_grandfather", label: "증조부" },
      { value: "great_grandmother", label: "증조모" },
    ],
    spouse: [
      { value: "husband", label: "남편" },
      { value: "wife", label: "아내" },
    ],
    sibling: [
      { value: "brother", label: "형제" },
      { value: "sister", label: "자매" },
    ],
  };

  return (
    <div onClick={onClose} style={{ ...bgStyle, zIndex: 110 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, maxWidth: 520 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>가족 관계 추가</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#64748b" }}>×</button>
        </div>
        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {!selected ? (
            <>
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>
                관계를 맺을 사람의 이름을 입력하고 검색하세요.
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="이름" style={{ ...editInput, flex: 2, marginBottom: 0 }}
                  onKeyDown={(e) => e.key === "Enter" && search()} />
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="휴대폰 (선택)" style={{ ...editInput, flex: 2, marginBottom: 0 }}
                  onKeyDown={(e) => e.key === "Enter" && search()} />
                <button onClick={search} style={btnPrimary}>{searching ? "..." : "검색"}</button>
              </div>
              {candidates.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {candidates.map(c => (
                    <div key={c.id} onClick={() => setSelected(c)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: 10,
                      background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0", cursor: "pointer",
                    }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", background: "#e2e8f0", flexShrink: 0 }}>
                        {c.photo_url && <img src={c.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                          {c.name} {c.phone && <span style={{ color: "#64748b", fontWeight: 400, fontSize: 11 }}>({c.phone})</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b" }}>
                          {c.plain_name ? `${c.plain_name}평원 · ` : ""}{c.pasture_name || "-"} 목장 · {c.sub_role || c.family_church}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: "#6366f1", fontWeight: 700 }}>선택 →</div>
                    </div>
                  ))}
                </div>
              )}
              {candidates.length === 0 && !searching && name && (
                <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: 16 }}>검색 결과 없음</div>
              )}
            </>
          ) : (
            <>
              <div style={{ padding: 12, background: "#eff6ff", borderRadius: 10, marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", background: "#dbeafe" }}>
                  {selected.photo_url && <img src={selected.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.name} {selected.phone && <span style={{ color: "#64748b", fontWeight: 400, fontSize: 11 }}>({selected.phone})</span>}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{selected.pasture_name} 목장</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ fontSize: 11, padding: "4px 10px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>다시</button>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>관계 유형</div>
                <select value={kind} onChange={(e) => { setKind(e.target.value); setRole(ROLE_OPTIONS[e.target.value]?.[0]?.value || ""); }} style={editInput}>
                  {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>세부 역할</div>
                <select value={role} onChange={(e) => setRole(e.target.value)} style={editInput}>
                  {(ROLE_OPTIONS[kind] || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSelected(null)} style={{ ...btnGhost, flex: 1 }}>뒤로</button>
                <button onClick={submit} style={{ ...btnPrimary, flex: 1 }}>관계 추가</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


// ============ Styles ============
const bgStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 100, padding: 16,
};
const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 18, width: "100%", maxWidth: 560,
  maxHeight: "90vh", display: "flex", flexDirection: "column",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};
const editInput: React.CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: 13,
  border: "1.5px solid #e2e8f0", borderRadius: 8, outline: "none",
  color: "#0f172a", fontWeight: 500, boxSizing: "border-box",
  fontFamily: "inherit", marginBottom: 6, background: "#fff",
};
const editInputLg: React.CSSProperties = { ...editInput, fontSize: 18, fontWeight: 700 };
const btnPrimary: React.CSSProperties = {
  padding: "8px 16px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
  padding: "8px 16px", background: "#f1f5f9", border: "none",
  borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer",
  fontFamily: "inherit", fontWeight: 600,
};
const btnMiniPrimary: React.CSSProperties = {
  padding: "4px 10px", background: "#6366f1", color: "#fff",
  border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
