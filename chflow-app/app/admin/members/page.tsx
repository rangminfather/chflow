"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Member {
  id: string;
  name: string;
  phone: string;
  gender: string | null;
  family_church: string;
  sub_role: string;
  spouse_name: string;
  address: string;
  pasture_name: string;
  grassland_name: string;
  plain_name: string;
  guard_status: string;
  has_account: boolean;
  is_child: boolean;
  source_page: number | null;
  photo_url: string | null;
  total_count: number;
}

interface DirRow {
  plain_id: string; plain_name: string; plain_order: number;
  grassland_id: string | null; grassland_name: string | null;
  pasture_id: string | null; pasture_name: string | null;
}

interface Household {
  id: string;
  address: string;
  home_phone: string;
  order_no: number;
  members_summary: string;
}

const PAGE_SIZE = 50;

export default function AdminMembersPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // 필터/검색
  const [query, setQuery] = useState("");
  const [filterPlain, setFilterPlain] = useState("");
  const [filterGrassland, setFilterGrassland] = useState("");
  const [filterPasture, setFilterPasture] = useState("");

  // 데이터
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // 디렉토리 트리
  const [dirTree, setDirTree] = useState<DirRow[]>([]);

  // 모달
  const [editing, setEditing] = useState<Member | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Member | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/home"); return;
      }
      setAuthChecked(true);
      const { data: tree } = await supabase.rpc("directory_tree");
      if (tree) setDirTree(tree);
      doSearch(1, "", "", "", "");
    })();
  }, []);

  const doSearch = async (p: number, q: string, plain: string, grass: string, past: string) => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_search_members_paged", {
      p_query: q || null,
      p_plain: plain || null,
      p_grassland: grass || null,
      p_pasture: past || null,
      p_offset: (p - 1) * PAGE_SIZE,
      p_limit: PAGE_SIZE,
    });
    if (!error && data) {
      setMembers(data);
      setTotal(data[0]?.total_count || 0);
    }
    setLoading(false);
  };

  const runSearch = () => { setPage(1); doSearch(1, query, filterPlain, filterGrassland, filterPasture); };
  const goPage = (p: number) => { setPage(p); doSearch(p, query, filterPlain, filterGrassland, filterPasture); };

  // 평원 → 초원 목록 (평원 미선택 시 전체)
  const grasslandOptions = useMemo(() => {
    const set = new Set<string>();
    dirTree.forEach(r => {
      if ((!filterPlain || r.plain_name === filterPlain) && r.grassland_name) set.add(r.grassland_name);
    });
    return Array.from(set).sort();
  }, [dirTree, filterPlain]);

  // 초원 → 목장 목록 (평원/초원 미선택 시 전체)
  const pastureOptions = useMemo(() => {
    const set = new Set<string>();
    dirTree.forEach(r => {
      if ((!filterPlain || r.plain_name === filterPlain)
          && (!filterGrassland || r.grassland_name === filterGrassland)
          && r.pasture_name) set.add(r.pasture_name);
    });
    return Array.from(set).sort();
  }, [dirTree, filterPlain, filterGrassland]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSave = async () => {
    if (!editing) return;
    const { error } = await supabase.rpc("admin_update_member", {
      p_member_id: editing.id,
      p_name: editing.name,
      p_phone: editing.phone,
      p_family_church: editing.family_church,
      p_sub_role: editing.sub_role,
      p_spouse_name: editing.spouse_name,
      p_gender: editing.gender || null,
      p_is_child: editing.is_child,
    });
    if (error) { alert(`수정 실패: ${error.message}`); return; }
    setEditing(null);
    doSearch(page, query, filterPlain, filterGrassland, filterPasture);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.rpc("admin_delete_member", { p_member_id: deleting.id });
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    setDeleting(null);
    doSearch(page, query, filterPlain, filterGrassland, filterPasture);
  };

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>로딩 중...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif", padding: 16 }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>회원 관리</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>명성교회 성도 데이터베이스</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setCreating(true)} style={btnPrimary}>+ 회원 추가</button>
            <button onClick={() => router.push("/admin/pending")} style={btnWarning}>⏳ 가입 대기자</button>
            <button onClick={() => router.push("/home")} style={btnGhost}>← 홈</button>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="이름 또는 휴대폰 검색"
              style={{ flex: 1, minWidth: 180, ...inputStyle }}
            />
            <select value={filterPlain}
              onChange={(e) => { setFilterPlain(e.target.value); setFilterGrassland(""); setFilterPasture(""); }}
              style={{ ...selectStyle, minWidth: 110 }}>
              <option value="">전체 평원</option>
              {["1", "2", "3", "젊은이"].map(p => (
                <option key={p} value={p}>{p === "젊은이" ? "젊은이평원" : `${p}평원`}</option>
              ))}
            </select>
            <select value={filterGrassland}
              onChange={(e) => { setFilterGrassland(e.target.value); setFilterPasture(""); }}
              style={{ ...selectStyle, minWidth: 120 }}>
              <option value="">전체 초원</option>
              {grasslandOptions.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={filterPasture}
              onChange={(e) => setFilterPasture(e.target.value)}
              style={{ ...selectStyle, minWidth: 120 }}>
              <option value="">전체 목장</option>
              {pastureOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={runSearch} disabled={loading} style={btnPrimary}>
              {loading ? "조회 중..." : "🔍 검색"}
            </button>
            <button onClick={() => { setQuery(""); setFilterPlain(""); setFilterGrassland(""); setFilterPasture(""); setPage(1); doSearch(1, "", "", "", ""); }}
              style={btnGhost}>초기화</button>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
              총 <span style={{ color: "#6366f1" }}>{total}</span>명 · {page}/{totalPages} 페이지
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  {["평원", "초원", "목장", "이름", "성별", "자녀", "가정교회", "직분", "배우자", "휴대폰", "주소", "구분", "작업"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={tdStyle}>{m.plain_name || "-"}</td>
                    <td style={tdStyle}>{m.grassland_name || "-"}</td>
                    <td style={tdStyle}>{m.pasture_name || "-"}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: "#1e293b" }}>
                      {m.photo_url && <img src={m.photo_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", marginRight: 6, verticalAlign: "middle" }} />}
                      {m.name}
                    </td>
                    <td style={tdStyle}>{m.gender === "M" ? "남" : m.gender === "F" ? "여" : "-"}</td>
                    <td style={tdStyle}>{m.is_child ? "👶" : ""}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 11,
                        background: m.family_church === "목자" ? "#dbeafe" : m.family_church === "목녀" ? "#fce7f3" : "#f1f5f9",
                        color: m.family_church === "목자" ? "#1e40af" : m.family_church === "목녀" ? "#9d174d" : "#475569",
                      }}>{m.family_church || "-"}</span>
                    </td>
                    <td style={tdStyle}>{m.sub_role || "-"}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{m.spouse_name || "-"}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "#475569" }}>{m.phone || "-"}</td>
                    <td style={{ ...tdStyle, color: "#64748b", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.address || "-"}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 10,
                        background: m.has_account ? "#dcfce7" : "#fef3c7",
                        color: m.has_account ? "#15803d" : "#92400e",
                      }}>{m.has_account ? "회원" : "비회원"}</span>
                    </td>
                    <td style={tdStyle}>
                      <button onClick={() => setEditing({ ...m })} style={{ ...btnMini, background: "#6366f1", color: "#fff" }}>수정</button>
                      <button onClick={() => setDeleting(m)} style={{ ...btnMini, background: "#fecaca", color: "#b91c1c", marginLeft: 4 }}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {members.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>검색 결과가 없습니다</div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "center", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => goPage(1)} disabled={page === 1} style={pageBtn(page === 1)}>«</button>
              <button onClick={() => goPage(Math.max(1, page - 1))} disabled={page === 1} style={pageBtn(page === 1)}>‹</button>
              {renderPageNumbers(page, totalPages).map((p, i) =>
                p === -1
                  ? <span key={i} style={{ padding: "0 6px", color: "#94a3b8" }}>…</span>
                  : <button key={i} onClick={() => goPage(p)} style={pageBtn(false, p === page)}>{p}</button>
              )}
              <button onClick={() => goPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} style={pageBtn(page === totalPages)}>›</button>
              <button onClick={() => goPage(totalPages)} disabled={page === totalPages} style={pageBtn(page === totalPages)}>»</button>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editing && <EditModal member={editing} setMember={setEditing} onSave={handleSave} onClose={() => setEditing(null)} />}

      {/* Delete Confirm */}
      {deleting && (
        <ConfirmModal
          title="회원 삭제"
          message={`${deleting.name} 님을 삭제하시겠습니까?${deleting.has_account ? "\n⚠️ 앱 계정과 연결돼 있어 삭제 불가할 수 있습니다." : ""}`}
          onConfirm={handleDelete}
          onClose={() => setDeleting(null)}
        />
      )}

      {/* Create Modal */}
      {creating && (
        <CreateModal
          dirTree={dirTree}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); doSearch(page, query, filterPlain, filterGrassland, filterPasture); }}
        />
      )}
    </div>
  );
}


function renderPageNumbers(cur: number, total: number): number[] {
  const out: number[] = [];
  const push = (n: number) => { if (!out.includes(n)) out.push(n); };
  push(1);
  if (cur > 4) out.push(-1);
  for (let p = Math.max(2, cur - 2); p <= Math.min(total - 1, cur + 2); p++) push(p);
  if (cur < total - 3) out.push(-1);
  if (total > 1) push(total);
  return out;
}


// ============ Edit Modal ============
function EditModal({ member, setMember, onSave, onClose }: {
  member: Member; setMember: (m: Member) => void; onSave: () => void; onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={modalBgStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 18 }}>회원 수정</div>
        <FormRow label="이름" value={member.name} onChange={(v) => setMember({ ...member, name: v })} />
        <FormRow label="휴대폰" value={member.phone} onChange={(v) => setMember({ ...member, phone: v })} />
        <div style={{ marginBottom: 10, display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lblStyle}>성별</label>
            <select value={member.gender || ""} onChange={(e) => setMember({ ...member, gender: e.target.value || null })}
              style={{ ...inputStyle, marginTop: 4 }}>
              <option value="">미지정</option>
              <option value="M">남</option>
              <option value="F">여</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "flex-end", gap: 6, fontSize: 12, fontWeight: 600, color: "#475569", paddingBottom: 10 }}>
            <input type="checkbox" checked={member.is_child}
              onChange={(e) => setMember({ ...member, is_child: e.target.checked })} />
            자녀
          </label>
        </div>
        <FormRow label="가정교회 (목자/목녀/목부/목원)" value={member.family_church} onChange={(v) => setMember({ ...member, family_church: v })} />
        <FormRow label="직분" value={member.sub_role} onChange={(v) => setMember({ ...member, sub_role: v })} />
        <FormRow label="배우자" value={member.spouse_name} onChange={(v) => setMember({ ...member, spouse_name: v })} />
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ ...btnGhost, flex: 1, padding: "12px" }}>취소</button>
          <button onClick={onSave} style={{ ...btnPrimary, flex: 1, padding: "12px" }}>저장</button>
        </div>
      </div>
    </div>
  );
}


// ============ Create Modal ============
function CreateModal({ dirTree, onClose, onCreated }: {
  dirTree: DirRow[]; onClose: () => void; onCreated: () => void;
}) {
  const [plain, setPlain] = useState("");
  const [grassland, setGrassland] = useState("");
  const [pasture, setPasture] = useState("");
  const [households, setHouseholds] = useState<Household[]>([]);
  const [householdId, setHouseholdId] = useState<string>("");
  const [newFamily, setNewFamily] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [isChild, setIsChild] = useState(false);
  const [familyChurch, setFamilyChurch] = useState("목원");
  const [subRole, setSubRole] = useState("");
  const [spouseName, setSpouseName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const grasslandsForPlain = useMemo(() => {
    const s = new Set<string>();
    dirTree.forEach(r => { if (r.plain_name === plain && r.grassland_name) s.add(r.grassland_name); });
    return Array.from(s);
  }, [dirTree, plain]);

  const pasturesForGrassland = useMemo(() => {
    const arr: { id: string; name: string }[] = [];
    dirTree.forEach(r => {
      if (r.plain_name === plain && r.grassland_name === grassland && r.pasture_id && r.pasture_name) {
        arr.push({ id: r.pasture_id, name: r.pasture_name });
      }
    });
    return arr;
  }, [dirTree, plain, grassland]);

  const selectedPastureId = useMemo(() => pasturesForGrassland.find(p => p.name === pasture)?.id || "", [pasturesForGrassland, pasture]);

  useEffect(() => {
    if (!selectedPastureId) { setHouseholds([]); return; }
    (async () => {
      const { data } = await supabase.rpc("households_by_pasture", { p_pasture_id: selectedPastureId });
      if (data) setHouseholds(data);
    })();
  }, [selectedPastureId]);

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("이름을 입력하세요");
    if (!selectedPastureId) return setError("목장을 선택하세요");
    if (!newFamily && !householdId) return setError("가족을 선택하거나 '신규 가족' 을 체크하세요");

    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc("admin_create_member", {
      p_name: name.trim(),
      p_phone: phone,
      p_family_church: familyChurch,
      p_sub_role: subRole,
      p_spouse_name: spouseName,
      p_household_id: newFamily ? null : householdId,
      p_pasture_id: newFamily ? selectedPastureId : null,
      p_gender: gender || null,
      p_is_child: isChild,
      p_birth_date: null,
      p_address: address,
    });
    setSaving(false);
    if (rpcError) { setError(`추가 실패: ${rpcError.message}`); return; }
    onCreated();
  };

  return (
    <div onClick={onClose} style={modalBgStyle}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, maxWidth: 560 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 18 }}>회원 추가</div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 6 }}>소속 *</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <select value={plain} onChange={(e) => { setPlain(e.target.value); setGrassland(""); setPasture(""); setHouseholdId(""); }} style={{ ...inputStyle, flex: 1 }}>
            <option value="">평원</option>
            {["1", "2", "3", "젊은이"].map(p => <option key={p} value={p}>{p === "젊은이" ? "젊은이평원" : `${p}평원`}</option>)}
          </select>
          <select value={grassland} onChange={(e) => { setGrassland(e.target.value); setPasture(""); setHouseholdId(""); }}
            disabled={!plain} style={{ ...inputStyle, flex: 1, background: plain ? "#fff" : "#f1f5f9" }}>
            <option value="">초원</option>
            {grasslandsForPlain.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={pasture} onChange={(e) => { setPasture(e.target.value); setHouseholdId(""); }}
            disabled={!grassland} style={{ ...inputStyle, flex: 1, background: grassland ? "#fff" : "#f1f5f9" }}>
            <option value="">목장</option>
            {pasturesForGrassland.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>

        {selectedPastureId && (
          <div style={{ marginBottom: 12 }}>
            <label style={lblStyle}>가족 (household)</label>
            <select value={newFamily ? "__new__" : householdId}
              onChange={(e) => {
                if (e.target.value === "__new__") { setNewFamily(true); setHouseholdId(""); }
                else { setNewFamily(false); setHouseholdId(e.target.value); }
              }}
              style={{ ...inputStyle, marginTop: 4 }}>
              <option value="">기존 가족 선택...</option>
              {households.map(h => (
                <option key={h.id} value={h.id}>
                  {h.members_summary || "(빈 가족)"} {h.address ? ` · ${h.address.slice(0, 25)}` : ""}
                </option>
              ))}
              <option value="__new__">➕ 신규 가족 만들기</option>
            </select>
            {newFamily && (
              <input value={address} onChange={(e) => setAddress(e.target.value)}
                placeholder="주소 (선택)" style={{ ...inputStyle, marginTop: 6 }} />
            )}
          </div>
        )}

        <FormRow label="이름 *" value={name} onChange={setName} />
        <FormRow label="휴대폰" value={phone} onChange={setPhone} placeholder="010-0000-0000" />

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lblStyle}>성별</label>
            <select value={gender} onChange={(e) => setGender(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="">미지정</option>
              <option value="M">남</option>
              <option value="F">여</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "flex-end", gap: 6, fontSize: 12, fontWeight: 600, color: "#475569", paddingBottom: 10 }}>
            <input type="checkbox" checked={isChild} onChange={(e) => setIsChild(e.target.checked)} />
            자녀
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lblStyle}>가정교회</label>
            <select value={familyChurch} onChange={(e) => setFamilyChurch(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="목원">목원</option>
              <option value="목자">목자</option>
              <option value="목녀">목녀</option>
              <option value="목부">목부</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={lblStyle}>직분</label>
            <input value={subRole} onChange={(e) => setSubRole(e.target.value)}
              placeholder="예: 집사, 권사, 장로 …" style={{ ...inputStyle, marginTop: 4 }} />
          </div>
        </div>

        <FormRow label="배우자" value={spouseName} onChange={setSpouseName} />

        {error && <div style={{ padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: "#b91c1c", marginBottom: 10 }}>⚠️ {error}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={onClose} style={{ ...btnGhost, flex: 1, padding: "12px" }}>취소</button>
          <button onClick={submit} disabled={saving} style={{ ...btnPrimary, flex: 1, padding: "12px" }}>
            {saving ? "추가 중..." : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ============ Confirm Modal ============
function ConfirmModal({ title, message, onConfirm, onClose }: {
  title: string; message: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={modalBgStyle}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, maxWidth: 360 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 14 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, marginBottom: 18, whiteSpace: "pre-wrap" }}>{message}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ ...btnGhost, flex: 1, padding: "12px" }}>취소</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: "12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>확인</button>
        </div>
      </div>
    </div>
  );
}


// ============ Form Row ============
function FormRow({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={lblStyle}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ ...inputStyle, marginTop: 4 }} />
    </div>
  );
}


// ============ Styles ============
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 13,
  border: "1.5px solid #e2e8f0", borderRadius: 8, outline: "none",
  color: "#0f172a", fontWeight: 500, boxSizing: "border-box", fontFamily: "inherit", background: "#fff",
};
const selectStyle: React.CSSProperties = { ...inputStyle, width: "auto" };
const lblStyle: React.CSSProperties = { fontSize: 11, color: "#475569", fontWeight: 700 };
const thStyle: React.CSSProperties = { padding: "10px 8px", textAlign: "left", fontWeight: 700, color: "#475569", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "8px" };

const btnPrimary: React.CSSProperties = {
  padding: "10px 16px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
  padding: "10px 16px", background: "#f1f5f9", border: "none",
  borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
};
const btnWarning: React.CSSProperties = {
  padding: "10px 16px", background: "#fef3c7", color: "#92400e", border: "none",
  borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const btnMini: React.CSSProperties = {
  padding: "4px 10px", border: "none", borderRadius: 4, fontSize: 11,
  cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
};
const pageBtn = (disabled: boolean, active?: boolean): React.CSSProperties => ({
  minWidth: 30, padding: "5px 10px", border: "1px solid #e2e8f0",
  borderRadius: 6, background: active ? "#6366f1" : "#fff",
  color: active ? "#fff" : disabled ? "#cbd5e1" : "#475569",
  fontSize: 12, fontWeight: 700, cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
});

const modalBgStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
};
const modalStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 16, padding: 24,
  width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
};
