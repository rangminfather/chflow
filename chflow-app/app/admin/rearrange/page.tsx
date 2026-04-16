"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface TreeRow {
  plain_id: string;  plain_name: string;  plain_order: number;
  grassland_id: string;  grassland_name: string;
  pasture_id: string;  pasture_name: string;
  leader_name: string | null;
  leader_photo: string | null;
  leader_gender: string | null;
  spouse_name: string | null;
  spouse_photo: string | null;
  member_count: number;
}

interface Pasture {
  id: string;
  name: string;
  grassland_id: string | null;        // null = 미배치
  leader_name: string | null;
  leader_photo: string | null;
  leader_gender: string | null;
  spouse_name: string | null;
  spouse_photo: string | null;
  member_count: number;
}

interface Grassland {
  id: string;
  name: string;
  plain_id: string;  // plain.id
  order_no: number;
}

interface Plain {
  id: string;
  name: string;
  display_name: string;
  order_no: number;
}

const PLAIN_ORDER = ["1", "2", "3", "젊은이"];

export default function RearrangePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [plains, setPlains] = useState<Plain[]>([]);
  const [grasslands, setGrasslands] = useState<Grassland[]>([]);
  const [pastures, setPastures] = useState<Pasture[]>([]);
  const [loading, setLoading] = useState(true);

  // 드래그 상태
  const dragRef = useRef<{ kind: "pasture" | "grassland"; id: string } | null>(null);
  const [dragOver, setDragOver] = useState<string>(""); // 드롭 대상 id 하이라이트

  // 검색 input (각 초원 or 미배치 풀별)
  const [searchInputs, setSearchInputs] = useState<Record<string, string>>({});

  // 저장 상태
  const [saving, setSaving] = useState(false);
  const [unplacedWarn, setUnplacedWarn] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

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
      await loadTree();
    })();
  }, []);

  const loadTree = async () => {
    setLoading(true);
    const [treeRes, plainsRes, grassRes] = await Promise.all([
      supabase.rpc("rearrange_tree"),
      supabase.from("plains").select("id,name,display_name,order_no").order("order_no"),
      supabase.from("grasslands").select("id,name,plain_id,order_no").order("order_no"),
    ]);
    if (plainsRes.data) setPlains(plainsRes.data);
    if (grassRes.data) setGrasslands(grassRes.data);

    if (treeRes.data) {
      const tree = treeRes.data as TreeRow[];
      const pastureMap = new Map<string, Pasture>();
      tree.forEach(r => {
        if (!pastureMap.has(r.pasture_id)) {
          pastureMap.set(r.pasture_id, {
            id: r.pasture_id, name: r.pasture_name,
            grassland_id: r.grassland_id,
            leader_name: r.leader_name, leader_photo: r.leader_photo,
            leader_gender: r.leader_gender,
            spouse_name: r.spouse_name, spouse_photo: r.spouse_photo,
            member_count: r.member_count,
          });
        }
      });
      setPastures(Array.from(pastureMap.values()));
    }
    setLoading(false);
  };

  // 드래그 시작
  const onDragStart = (kind: "pasture" | "grassland", id: string) => (e: React.DragEvent) => {
    dragRef.current = { kind, id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${kind}:${id}`);
  };

  const onDragOver = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(targetId);
  };
  const onDragLeave = () => setDragOver("");

  // 목장을 초원에 드롭
  const dropPastureToGrassland = (grasslandId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver("");
    const d = dragRef.current;
    if (!d || d.kind !== "pasture") return;
    setPastures(prev => prev.map(p => p.id === d.id ? { ...p, grassland_id: grasslandId } : p));
    setDirty(true);
    dragRef.current = null;
  };

  // 초원을 평원에 드롭
  const dropGrasslandToPlain = (plainId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver("");
    const d = dragRef.current;
    if (!d || d.kind !== "grassland") return;
    setGrasslands(prev => prev.map(g => g.id === d.id ? { ...g, plain_id: plainId } : g));
    setDirty(true);
    dragRef.current = null;
  };

  // 목장 → 미배치 풀로 (삭제 아이콘 클릭)
  const sendToUnplaced = (pastureId: string) => {
    setPastures(prev => prev.map(p => p.id === pastureId ? { ...p, grassland_id: null } : p));
    setDirty(true);
  };

  // 검색으로 미배치 풀에서 목장 가져와 초원에 배치
  const searchAddToGrassland = (grasslandId: string) => {
    const q = (searchInputs[grasslandId] || "").trim();
    if (!q) return;
    const unplaced = pastures.filter(p => p.grassland_id === null);
    const hit = unplaced.find(p => p.name.includes(q) || (p.leader_name || "").includes(q));
    if (!hit) { alert(`"${q}" 과 일치하는 미배치 목장이 없습니다.`); return; }
    setPastures(prev => prev.map(p => p.id === hit.id ? { ...p, grassland_id: grasslandId } : p));
    setSearchInputs(s => ({ ...s, [grasslandId]: "" }));
    setDirty(true);
  };

  // 신규 초원 생성
  const addGrassland = async (plainId: string) => {
    const name = prompt("새 초원 이름 (예: 초원장 성함)");
    if (!name || !name.trim()) return;
    const { data, error } = await supabase.rpc("create_grassland", { p_plain_id: plainId, p_name: name.trim() });
    if (error) { alert(`생성 실패: ${error.message}`); return; }
    setGrasslands(prev => [...prev, { id: data as any as string, name: name.trim(), plain_id: plainId, order_no: 0 }]);
    setDirty(true);
  };

  // 저장
  const handleSave = async () => {
    const unplaced = pastures.filter(p => p.grassland_id === null);
    if (unplaced.length > 0) {
      setUnplacedWarn(unplaced.map(p => p.name));
      return;
    }
    setSaving(true);
    const payload = {
      grasslands: grasslands.map(g => ({ id: g.id, plain_id: g.plain_id, order_no: g.order_no })),
      pastures: pastures
        .filter(p => p.grassland_id)
        .map(p => ({ id: p.id, grassland_id: p.grassland_id })),
    };
    const { error } = await supabase.rpc("rearrange_save", { p_payload: payload });
    setSaving(false);
    if (error) { alert(`저장 실패: ${error.message}`); return; }
    alert("재편성이 저장되었습니다.");
    setDirty(false);
    await loadTree();
  };

  if (!authChecked || loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>로딩 중...</div>;
  }

  const unplaced = pastures.filter(p => p.grassland_id === null);
  const plainsSorted = [...plains].sort((a, b) =>
    PLAIN_ORDER.indexOf(a.name) - PLAIN_ORDER.indexOf(b.name) || a.order_no - b.order_no);

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", fontFamily: "'Noto Sans KR', sans-serif", padding: 16, color: "#f1f5f9" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ maxWidth: 1800, margin: "0 auto 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>초원 재편성</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>2년 주기 목장 대이동 — 드래그로 옮기고 마지막에 저장</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dirty && <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600 }}>● 변경사항 있음</span>}
          <button onClick={() => router.push("/admin/members")} style={{ padding: "8px 14px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>← 회원 관리</button>
          <button onClick={loadTree} style={{ padding: "8px 14px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>↻ 되돌리기</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 18px", background: "linear-gradient(135deg, #22c55e, #16a34a)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{saving ? "저장 중..." : "💾 저장"}</button>
        </div>
      </div>

      {/* 미배치 풀 */}
      <div
        onDragOver={onDragOver("__unplaced__")}
        onDragLeave={onDragLeave}
        onDrop={dropPastureToGrassland(null)}
        style={{
          maxWidth: 1800, margin: "0 auto 12px",
          padding: 12,
          background: dragOver === "__unplaced__" ? "rgba(239,68,68,0.18)" : "rgba(239,68,68,0.08)",
          border: `2px dashed ${dragOver === "__unplaced__" ? "#ef4444" : "#7f1d1d"}`,
          borderRadius: 12, minHeight: 80,
        }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fecaca", marginBottom: 8 }}>
          🗑️ 미배치 목장 ({unplaced.length}) — 이곳에 있는 목장은 저장되지 않습니다
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {unplaced.map(p => (
            <PastureCard key={p.id} pasture={p}
              onDragStart={onDragStart("pasture", p.id)}
              onDelete={() => sendToUnplaced(p.id)}
              compact
            />
          ))}
          {unplaced.length === 0 && <div style={{ fontSize: 11, color: "#fecaca", opacity: 0.6 }}>모든 목장이 배치되어 있습니다</div>}
        </div>
      </div>

      {/* 4 평원 가로 배치 */}
      <div style={{ maxWidth: 1800, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {plainsSorted.map(pl => {
          const plainGrasslands = grasslands.filter(g => g.plain_id === pl.id).sort((a, b) => a.order_no - b.order_no);
          const plainPastureCnt = pastures.filter(p => p.grassland_id && plainGrasslands.some(g => g.id === p.grassland_id)).length;
          return (
            <div key={pl.id}
              onDragOver={onDragOver(`plain:${pl.id}`)}
              onDragLeave={onDragLeave}
              onDrop={dropGrasslandToPlain(pl.id)}
              style={{
                background: dragOver === `plain:${pl.id}` ? "rgba(99,102,241,0.18)" : "#1e293b",
                border: `2px solid ${dragOver === `plain:${pl.id}` ? "#6366f1" : "#334155"}`,
                borderRadius: 14, padding: "20px 16px 28px", minHeight: 640,
                display: "flex", flexDirection: "column",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#a5b4fc" }}>
                  {pl.display_name || `${pl.name}평원`}
                </div>
                <div style={{ fontSize: 10, color: "#64748b" }}>
                  초원 {plainGrasslands.length} · 목장 {plainPastureCnt}
                </div>
              </div>
              {/* 평원 drop hint: 다른 평원에서 초원을 끌어다 놓을 수 있는 상단 영역 */}
              <div style={{
                fontSize: 10, color: "#475569", textAlign: "center",
                padding: "12px 8px", marginBottom: 14,
                border: `1.5px dashed ${dragOver === `plain:${pl.id}` ? "#6366f1" : "#334155"}`,
                borderRadius: 10, background: dragOver === `plain:${pl.id}` ? "rgba(99,102,241,0.12)" : "transparent",
              }}>
                ↓ 여기에 초원을 끌어다 놓으면 이 평원으로 이동합니다
              </div>
              <button onClick={() => addGrassland(pl.id)} style={{ width: "100%", marginBottom: 14, padding: "8px", background: "#334155", color: "#cbd5e1", border: "1px dashed #475569", borderRadius: 8, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>+ 새 초원</button>

              <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                {plainGrasslands.map(g => {
                  const gp = pastures.filter(p => p.grassland_id === g.id);
                  return (
                    <div key={g.id}
                      draggable
                      onDragStart={onDragStart("grassland", g.id)}
                      onDragOver={(e) => { e.stopPropagation(); onDragOver(`grassland:${g.id}`)(e); }}
                      onDragLeave={onDragLeave}
                      onDrop={(e) => { e.stopPropagation(); dropPastureToGrassland(g.id)(e); }}
                      style={{
                        background: dragOver === `grassland:${g.id}` ? "rgba(34,197,94,0.18)" : "#0f172a",
                        border: `1.5px solid ${dragOver === `grassland:${g.id}` ? "#22c55e" : "#475569"}`,
                        borderRadius: 10, padding: 8, cursor: "grab",
                      }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#fde047" }}>
                          ⇅ {g.name} 초원 <span style={{ color: "#64748b", fontWeight: 400, fontSize: 10 }}>({gp.length})</span>
                        </div>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {gp.map(p => (
                          <PastureCard key={p.id} pasture={p}
                            onDragStart={onDragStart("pasture", p.id)}
                            onDelete={() => sendToUnplaced(p.id)}
                            compact
                          />
                        ))}
                      </div>

                      {/* 검색 추가 */}
                      <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                        <input
                          value={searchInputs[g.id] || ""}
                          onChange={(e) => setSearchInputs(s => ({ ...s, [g.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && searchAddToGrassland(g.id)}
                          placeholder="목장 검색 추가"
                          style={{ flex: 1, padding: "4px 8px", fontSize: 10, background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, outline: "none" }}
                        />
                        <button onClick={() => searchAddToGrassland(g.id)} style={{ padding: "4px 10px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>추가</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 미배치 경고 모달 */}
      {unplacedWarn.length > 0 && (
        <div onClick={() => setUnplacedWarn([])} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#fff", color: "#0f172a", borderRadius: 16, padding: 24,
            width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto",
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#b91c1c", marginBottom: 14 }}>⚠️ 저장할 수 없습니다</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, marginBottom: 12 }}>
              <strong>반드시 초원에 배치되어야 합니다.</strong>
              <br />다음 목장이 아직 초원에 배치되지 않았습니다:
            </div>
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 12, maxHeight: 300, overflowY: "auto", marginBottom: 16 }}>
              {unplacedWarn.map(n => (
                <div key={n} style={{ fontSize: 13, color: "#991b1b", padding: "4px 0" }}>• {n} 목장</div>
              ))}
            </div>
            <button onClick={() => setUnplacedWarn([])} style={{ width: "100%", padding: "12px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>확인</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ============ Pasture Card ============
function PastureCard({ pasture, onDragStart, onDelete, compact }: {
  pasture: Pasture; onDragStart: (e: React.DragEvent) => void; onDelete: () => void; compact?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const size = compact ? 44 : 56;
  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(e); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        background: "#1e293b", border: "1px solid #475569",
        borderRadius: 8, padding: "4px 8px 4px 4px",
        cursor: "grab", userSelect: "none",
        display: "flex", alignItems: "center", gap: 6,
        minWidth: 120, transition: "all 0.15s",
        boxShadow: hover ? "0 4px 12px rgba(99,102,241,0.4)" : "none",
        transform: hover ? "translateY(-1px)" : "none",
      }}>
      {/* 사진 */}
      <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", background: "#334155", flexShrink: 0, border: `2px solid ${pasture.leader_gender === "M" ? "#3b82f6" : pasture.leader_gender === "F" ? "#ec4899" : "#64748b"}` }}>
        {pasture.leader_photo ? (
          <img src={pasture.leader_photo} alt={pasture.leader_name || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#64748b" }}>
            {pasture.leader_gender === "F" ? "👩" : "👨"}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>{pasture.name} 목장</div>
        {pasture.leader_name && <div style={{ fontSize: 9, color: "#94a3b8" }}>{pasture.leader_name}{pasture.spouse_name ? `·${pasture.spouse_name}` : ""}</div>}
        <div style={{ fontSize: 9, color: "#64748b" }}>👥 {pasture.member_count}명</div>
      </div>
      {hover && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: "50%", background: "#ef4444", color: "#fff", border: "none", fontSize: 11, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }}
          title="미배치로 빼기">×</button>
      )}
    </div>
  );
}
