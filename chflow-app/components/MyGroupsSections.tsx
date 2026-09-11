// =============================================================
// 내 사역 · 부서 / 목장 메뉴 — /my-groups 페이지 전용 (원래 app/home/page.tsx에 있던 것을 분리)
//   홈 화면에는 COMMON_MENUS의 "내 사역·목장" 타일 하나만 두고, 실제 목록은 여기서 보여준다.
// =============================================================
"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { useRouter } from "next/navigation";
import {
  Folder, Home, CalendarDays, BookText, SearchCheck,
  ChevronRight, ChevronUp, ChevronDown, Pencil, EyeOff,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import DeptIcon from "@/components/DeptIcon";
import {
  T, Section, SectionHeader,
  SafeCard, SafeRow, SafeGrow, IconBox, Badge,
} from "@/components/Layout";
import {
  applyHomeMenuConfig, homeMenuKeyOf, resolveHomeSectionLabel,
  type HomeMenuConfig,
} from "@/lib/homeMenuConfig";
import {
  HOME_SECTION_DEFAULT_LABELS, MenuEditGearButton, SectionTitleInput, EditHomeMenuPopup,
  type UserInfo, type MyDepartment,
} from "@/app/home/page";

type RouterType = ReturnType<typeof useRouter>;

async function moveHomeSubmenu(
  groupId: string,
  orderedIds: string[],
  menuId: string,
  direction: -1 | 1,
  onMenuConfigChange: Dispatch<SetStateAction<HomeMenuConfig>>,
  onError: (message: string) => void,
) {
  const from = orderedIds.indexOf(menuId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= orderedIds.length) return;
  const next = [...orderedIds];
  [next[from], next[to]] = [next[to], next[from]];
  onMenuConfigChange((prev) => ({ ...prev, order: { ...prev.order, [groupId]: next } }));
  const { error } = await supabase.rpc("set_home_menu_item_order", { p_group: groupId, p_order: next });
  if (!error) return;
  onMenuConfigChange((prev) => ({ ...prev, order: { ...prev.order, [groupId]: orderedIds } }));
  onError(`순서 저장 실패: ${error.message}`);
}

function SubmenuEditControls({ hidden, first, last, onMove, onEdit }: {
  hidden: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
}) {
  const buttonStyle = {
    width: 28, height: 28, borderRadius: 7, border: "1px solid var(--hairline)",
    background: "var(--card)", color: "var(--ink-mid)", cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0,
  } as const;
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      {hidden && <EyeOff size={13} strokeWidth={2} color="var(--ink-faint)" aria-label="숨김" />}
      <button type="button" aria-label="위로 이동" disabled={first} onClick={() => onMove(-1)} style={{ ...buttonStyle, opacity: first ? 0.3 : 1 }}>
        <ChevronUp size={15} strokeWidth={2} />
      </button>
      <button type="button" aria-label="아래로 이동" disabled={last} onClick={() => onMove(1)} style={{ ...buttonStyle, opacity: last ? 0.3 : 1 }}>
        <ChevronDown size={15} strokeWidth={2} />
      </button>
      <button type="button" aria-label="메뉴 이름과 표시 여부 수정" onClick={onEdit} style={buttonStyle}>
        <Pencil size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

// =============================================================
// 1) 내 사역 · 부서
// =============================================================
export function MinistrySection({ myDepartments, router, canEditMenu, menuConfig, onMenuConfigChange }: {
  myDepartments: MyDepartment[];
  router: RouterType;
  canEditMenu: boolean;
  menuConfig: HomeMenuConfig;
  onMenuConfigChange: Dispatch<SetStateAction<HomeMenuConfig>>;
}) {
  const approved = myDepartments.filter((d) => d.status === "approved");
  const pending = myDepartments.filter((d) => d.status === "pending");
  const baseDepartments = [...approved, ...pending].map((dept) => ({
    id: dept.department_id,
    label: dept.name,
    dept,
  }));
  const [editing, setEditing] = useState(false);
  const [editTarget, setEditTarget] = useState<{ menuId: string; defaultLabel: string } | null>(null);
  const sectionLabel = resolveHomeSectionLabel(menuConfig, "ministry", HOME_SECTION_DEFAULT_LABELS.ministry);
  const departments = applyHomeMenuConfig("ministry", baseDepartments, menuConfig, { includeHidden: editing });
  const orderedIds = departments.map((item) => item.id);

  return (
    <Section bg="var(--surface)" style={{ height: "100%", marginBottom: 0, border: "1px solid var(--hairline)" }}>
      <SectionHeader
        icon={<Folder size={18} strokeWidth={1.75} />}
        iconColor="var(--accent)"
        title={editing ? (
          <SectionTitleInput
            sectionId="ministry"
            value={sectionLabel}
            onSaved={onMenuConfigChange}
            onError={(msg) => alert(msg)}
          />
        ) : sectionLabel}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {canEditMenu && (
              <MenuEditGearButton
                active={editing}
                onClick={() => setEditing((v) => !v)}
                label={HOME_SECTION_DEFAULT_LABELS.ministry}
              />
            )}
            <button
              onClick={() => router.push("/departments")}
              style={{
                padding: "4px 10px", fontSize: 11, fontWeight: 700,
                color: T.ministryPoint, background: "transparent",
                border: `1.5px dashed ${T.ministryPoint}`, borderRadius: 8,
                cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >+ 가입</button>
          </div>
        }
      />

      {editing && (
        <div style={{ marginBottom: 10, fontSize: 11.5, fontWeight: 600, color: "var(--accent-strong)" }}>
          연필로 이름·숨김을 바꾸고 화살표로 순서를 변경합니다.
        </div>
      )}
      {departments.length === 0 ? (
        <SafeCard padding={13} style={{ marginBottom: 10, borderRadius: 10 }}>
          <div className="kr-keep" style={{ fontSize: 14, color: T.textMuted }}>
            아직 가입된 사역 · 부서가 없습니다
          </div>
        </SafeCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: "100%", minWidth: 0 }}>
          {departments.map((item, index) => (
            <MinistryCard
              key={item.dept.id}
              dept={item.dept}
              label={item.label}
              status={item.dept.status === "approved" ? "approved" : "pending"}
              hidden={item.hidden}
              editing={editing}
              onClick={() => editing
                ? setEditTarget({ menuId: item.id, defaultLabel: item.dept.name })
                : router.push(`/departments/d/${item.dept.department_id}`)}
              editControls={editing ? (
                <SubmenuEditControls
                  hidden={item.hidden}
                  first={index === 0}
                  last={index === departments.length - 1}
                  onMove={(direction) => void moveHomeSubmenu("ministry", orderedIds, item.id, direction, onMenuConfigChange, alert)}
                  onEdit={() => setEditTarget({ menuId: item.id, defaultLabel: item.dept.name })}
                />
              ) : undefined}
            />
          ))}
        </div>
      )}
      {editTarget && (
        <EditHomeMenuPopup
          groupId="ministry"
          menuId={editTarget.menuId}
          defaultLabel={editTarget.defaultLabel}
          setting={menuConfig.settings[homeMenuKeyOf("ministry", editTarget.menuId)]}
          onClose={() => setEditTarget(null)}
          onSaved={(next) => { onMenuConfigChange(next); setEditTarget(null); }}
        />
      )}
    </Section>
  );
}

function MinistryCard({ dept, label, status, hidden, editing, onClick, editControls }: {
  dept: MyDepartment;
  label: string;
  status: "approved" | "pending";
  hidden: boolean;
  editing: boolean;
  onClick: () => void;
  editControls?: React.ReactNode;
}) {
  return (
    <SafeCard onClick={onClick} padding={12} style={{ borderRadius: 14, background: "var(--card)", border: "1px solid var(--hairline)", boxShadow: "0 1px 4px rgba(26,22,18,0.04)", opacity: editing && hidden ? 0.55 : 1 }}>
      <SafeRow gap={12}>
        <IconBox bg="var(--accent-soft)" size={40}>
          <DeptIcon name={dept.name} category={dept.category} size={20} />
        </IconBox>
        <SafeGrow>
          <div className="line-clamp-1 kr-keep" style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>
            {dept.category}
          </div>
          <div className="line-clamp-1 kr-keep" style={{ fontSize: 15, fontWeight: 800, color: T.text, marginTop: 1 }}>
            {label}
          </div>
        </SafeGrow>
        <Badge tone={status === "approved" ? "success" : "warn"} label={status === "approved" ? "승인됨" : "가입중"} />
        {editControls}
      </SafeRow>
    </SafeCard>
  );
}

// =============================================================
// 2) 목장 메뉴 — 목장탐방(전체) + 목장 모임(전 목원) + 목장일지(목자/목녀 전용)
//    목장탐방은 누구나, 목장 모임은 소속 목장 구성원, 목장일지는 목자·목녀만 본다.
// =============================================================
export function CellShepherdSection({ user, router, canEditMenu, menuConfig, onMenuConfigChange }: {
  user: UserInfo;
  router: RouterType;
  canEditMenu: boolean;
  menuConfig: HomeMenuConfig;
  onMenuConfigChange: Dispatch<SetStateAction<HomeMenuConfig>>;
}) {
  const [editing, setEditing] = useState(false);
  const [editTarget, setEditTarget] = useState<{ menuId: string; defaultLabel: string } | null>(null);
  const isCellShepherd = user.family_church === "목자" || user.family_church === "목녀";
  const hasPasture = !!user.pasture_name;
  const sectionLabel = resolveHomeSectionLabel(menuConfig, "pasture", HOME_SECTION_DEFAULT_LABELS.pasture);
  const baseMenus = [
    { id: "meeting", label: "목장 모임", href: "/pasture", desc: `${user.pasture_name ?? "소속"}목장 · 가능일 표시 · 참석 확인`, icon: CalendarDays, available: hasPasture },
    { id: "journal", label: "목장일지", href: "/pasture/journal", desc: "해외선교 후원목장 · 본인 UMS 계정으로 열람", icon: BookText, available: isCellShepherd },
    { id: "explore", label: "목장탐방", href: "/pasture/explore", desc: "목장을 검색하고 소개를 둘러보세요", icon: SearchCheck, available: true },
  ];
  const configuredMenus = applyHomeMenuConfig("pasture", baseMenus, menuConfig, { includeHidden: editing });
  const menus = editing ? configuredMenus : configuredMenus.filter((menu) => menu.available);
  const orderedIds = configuredMenus.map((menu) => menu.id);

  return (
    <Section bg="var(--surface)" style={{ marginBottom: 18, border: "1px solid var(--hairline)" }}>
      <SectionHeader
        icon={<Home size={18} strokeWidth={1.75} />}
        iconColor="var(--accent)"
        title={editing ? (
          <SectionTitleInput
            sectionId="pasture"
            value={sectionLabel}
            onSaved={onMenuConfigChange}
            onError={(msg) => alert(msg)}
          />
        ) : sectionLabel}
        action={canEditMenu ? (
          <MenuEditGearButton
            active={editing}
            onClick={() => setEditing((v) => !v)}
            label={HOME_SECTION_DEFAULT_LABELS.pasture}
          />
        ) : undefined}
      />
      {editing && (
        <div style={{ marginBottom: 10, fontSize: 11.5, fontWeight: 600, color: "var(--accent-strong)" }}>
          연필로 이름·숨김을 바꾸고 화살표로 순서를 변경합니다.
        </div>
      )}
      {menus.map((menu, index) => {
        const MenuIcon = menu.icon;
        const defaultLabel = baseMenus.find((item) => item.id === menu.id)?.label ?? menu.label;
        return (
          <SafeCard
            key={menu.id}
            onClick={() => editing ? setEditTarget({ menuId: menu.id, defaultLabel }) : router.push(menu.href)}
            padding={12}
            style={{ borderRadius: 10, marginBottom: index === menus.length - 1 ? 0 : 8, opacity: editing && menu.hidden ? 0.55 : 1 }}
          >
            <SafeRow gap={12}>
              <IconBox bg="var(--accent-soft)" size={40}>
                <MenuIcon size={21} strokeWidth={1.75} color="var(--accent)" />
              </IconBox>
              <SafeGrow>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{menu.label}</div>
                <div className="line-clamp-1 kr-keep" style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{menu.desc}</div>
              </SafeGrow>
              {editing ? (
                <SubmenuEditControls
                  hidden={menu.hidden}
                  first={index === 0}
                  last={index === menus.length - 1}
                  onMove={(direction) => void moveHomeSubmenu("pasture", orderedIds, menu.id, direction, onMenuConfigChange, alert)}
                  onEdit={() => setEditTarget({ menuId: menu.id, defaultLabel })}
                />
              ) : <ChevronRight size={16} strokeWidth={1.8} color={T.textMuted} />}
            </SafeRow>
          </SafeCard>
        );
      })}
      {editTarget && (
        <EditHomeMenuPopup
          groupId="pasture"
          menuId={editTarget.menuId}
          defaultLabel={editTarget.defaultLabel}
          setting={menuConfig.settings[homeMenuKeyOf("pasture", editTarget.menuId)]}
          onClose={() => setEditTarget(null)}
          onSaved={(next) => { onMenuConfigChange(next); setEditTarget(null); }}
        />
      )}
    </Section>
  );
}
