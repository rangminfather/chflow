"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Member {
  id: string;
  name: string;
  phone: string;
  family_church: string;
  sub_role: string;
  spouse_name: string;
  address: string;
  pasture_name: string;
  grassland_name: string;
  plain_name: string;
  guard_status: string;
  has_account: boolean;
  source_page: number;
}

export default function AdminMembersPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [query, setQuery] = useState("");
  const [filterPlain, setFilterPlain] = useState("");
  const [filterPasture, setFilterPasture] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
      search();
    })();
  }, []);

  const search = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_search_members", {
      p_query: query || null,
      p_plain: filterPlain || null,
      p_pasture: filterPasture || null,
      p_limit: 200,
    });
    if (!error) setMembers(data || []);
    setLoading(false);
  };

  const handleEdit = (m: Member) => setEditing({ ...m });

  const handleSave = async () => {
    if (!editing) return;
    const { error } = await supabase.rpc("admin_update_member", {
      p_member_id: editing.id,
      p_name: editing.name,
      p_phone: editing.phone,
      p_family_church: editing.family_church,
      p_sub_role: editing.sub_role,
      p_spouse_name: editing.spouse_name,
    });
    if (error) {
      alert(`수정 실패: ${error.message}`);
      return;
    }
    setEditing(null);
    search();
  };

  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>
        로딩 중...
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f1f5f9",
      fontFamily: "'Noto Sans KR', sans-serif",
      padding: 16,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>회원 관리</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>명성교회 성도 데이터베이스</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => router.push("/admin/pending")} style={{
              padding: "8px 14px", background: "#fef3c7", color: "#92400e", border: "none",
              borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>⏳ 가입 대기자</button>
            <button onClick={() => router.push("/home")} style={{
              padding: "8px 14px", background: "#f1f5f9", border: "none",
              borderRadius: 8, fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit",
            }}>← 홈</button>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="이름 또는 휴대폰 검색"
              style={{
                flex: 1, minWidth: 200, padding: "10px 12px", fontSize: 13,
                border: "1.5px solid #e2e8f0", borderRadius: 8, outline: "none",
                color: "#0f172a", fontWeight: 500,
              }}
            />
            <select value={filterPlain} onChange={(e) => setFilterPlain(e.target.value)}
              style={{ padding: "10px 12px", fontSize: 13, border: "1.5px solid #e2e8f0", borderRadius: 8, color: "#0f172a", background: "#fff" }}>
              <option value="">전체 평원</option>
              <option value="1">1평원</option>
              <option value="2">2평원</option>
              <option value="3">3평원</option>
              <option value="젊은이">젊은이평원</option>
            </select>
            <input type="text" value={filterPasture} onChange={(e) => setFilterPasture(e.target.value)}
              placeholder="목장 이름"
              style={{ width: 140, padding: "10px 12px", fontSize: 13, border: "1.5px solid #e2e8f0", borderRadius: 8, color: "#0f172a" }} />
            <button onClick={search} disabled={loading} style={{
              padding: "10px 20px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}>{loading ? "조회 중..." : "검색"}</button>
          </div>
        </div>

        {/* Members Table */}
        <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
              총 {members.length}명
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  {["평원", "초원", "목장", "이름", "가정교회", "직분", "배우자", "휴대폰", "주소", "구분", "작업"].map(h => (
                    <th key={h} style={{ padding: "10px 8px", textAlign: "left", fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px" }}>{m.plain_name || "-"}</td>
                    <td style={{ padding: "8px" }}>{m.grassland_name || "-"}</td>
                    <td style={{ padding: "8px" }}>{m.pasture_name || "-"}</td>
                    <td style={{ padding: "8px", fontWeight: 700, color: "#1e293b" }}>{m.name}</td>
                    <td style={{ padding: "8px" }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 11,
                        background: m.family_church === "목자" ? "#dbeafe" : m.family_church === "목녀" ? "#fce7f3" : "#f1f5f9",
                        color: m.family_church === "목자" ? "#1e40af" : m.family_church === "목녀" ? "#9d174d" : "#475569",
                      }}>{m.family_church || "-"}</span>
                    </td>
                    <td style={{ padding: "8px" }}>{m.sub_role || "-"}</td>
                    <td style={{ padding: "8px", color: "#64748b" }}>{m.spouse_name || "-"}</td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap", color: "#475569" }}>{m.phone || "-"}</td>
                    <td style={{ padding: "8px", color: "#64748b", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.address || "-"}</td>
                    <td style={{ padding: "8px" }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 10,
                        background: m.has_account ? "#dcfce7" : "#fef3c7",
                        color: m.has_account ? "#15803d" : "#92400e",
                      }}>{m.has_account ? "회원" : "비회원"}</span>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <button onClick={() => handleEdit(m)} style={{
                        padding: "4px 10px", background: "#6366f1", color: "#fff",
                        border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                      }}>수정</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {members.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>
              검색 결과가 없습니다
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div onClick={() => setEditing(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, padding: 24,
            width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 20 }}>회원 수정</div>

            {[
              { key: "name", label: "이름" },
              { key: "phone", label: "휴대폰" },
              { key: "family_church", label: "가정교회 (목자/목녀/목부/목원)" },
              { key: "sub_role", label: "직분" },
              { key: "spouse_name", label: "배우자" },
            ].map((f) => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{f.label}</label>
                <input
                  type="text"
                  value={(editing as any)[f.key] || ""}
                  onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                  style={{
                    width: "100%", marginTop: 4, padding: "10px 12px", fontSize: 13,
                    border: "1.5px solid #e2e8f0", borderRadius: 8, color: "#0f172a", fontWeight: 500,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setEditing(null)} style={{
                flex: 1, padding: "12px", background: "#f1f5f9", color: "#475569",
                border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>취소</button>
              <button onClick={handleSave} style={{
                flex: 1, padding: "12px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
