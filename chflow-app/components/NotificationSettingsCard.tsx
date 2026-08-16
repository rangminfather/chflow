"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, Smartphone } from "lucide-react";
import {
  fetchNotificationPreferences,
  requestNotificationPermission,
  saveNotificationPreferences,
} from "@/lib/notifications";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences,
} from "@/lib/notificationPreferences";

export default function NotificationSettingsCard({ onSaved, embedded = false }: { onSaved?: (message: string) => void; embedded?: boolean }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  // 마지막 저장만 반영 (토글을 빠르게 여러 번 눌러도 순서가 뒤집히지 않게)
  const saveSeqRef = useRef(0);

  useEffect(() => {
    fetchNotificationPreferences().then((value) => {
      setPreferences(value);
      setLoading(false);
    });
  }, []);

  // 토글을 누르면 그 자리에서 저장한다. (저장 버튼을 누르기 전에 탭을 옮기면
  // 변경이 조용히 사라지던 문제 때문에 수동 저장을 없앴다)
  const apply = useCallback(async (next: NotificationPreferences) => {
    setPreferences(next);
    const seq = ++saveSeqRef.current;
    setSaving(true);
    setStatus("");
    try {
      if (next.enabled && next.push_enabled) {
        await requestNotificationPermission();
      }
      await saveNotificationPreferences(next);
      if (seq !== saveSeqRef.current) return;
      window.dispatchEvent(new CustomEvent("chflow:notification-preferences-changed", { detail: next }));
      setStatus("저장되었습니다");
      onSaved?.("알림 설정이 저장되었습니다");
    } catch (error) {
      const message = error instanceof Error ? error.message : "알림 설정을 저장하지 못했습니다";
      if (seq !== saveSeqRef.current) return;
      setStatus(message);
      onSaved?.(message);
    } finally {
      if (seq === saveSeqRef.current) setSaving(false);
    }
  }, [onSaved]);

  const set = <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => {
    void apply({ ...preferences, [key]: value });
  };

  const enableAll = () => {
    void apply({ ...DEFAULT_NOTIFICATION_PREFERENCES });
  };

  if (loading) {
    return <div style={embedded ? embeddedStyle : cardStyle}>알림 설정을 불러오는 중...</div>;
  }

  const allOn = preferences.enabled
    && preferences.push_enabled
    && preferences.in_app_enabled
    && NOTIFICATION_CATEGORIES.every((category) => preferences[`${category.key}_enabled`]);

  return (
    <div style={embedded ? embeddedStyle : cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <BellRing size={18} color="var(--accent)" />
        <strong style={{ fontSize: 14, color: "var(--ink)" }}>알림 설정</strong>
        {saving && <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>저장 중...</span>}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5, marginBottom: 12 }}>
        바꾸는 즉시 저장됩니다. 알림을 꺼도 <strong style={{ color: "var(--ink-soft)" }}>이미 받은 알림 목록과 배지는 그대로 남습니다.</strong>
      </div>

      {!allOn && (
        <button type="button" onClick={enableAll} style={enableAllButtonStyle}>
          모두 켜기
        </button>
      )}

      <SwitchRow
        icon={<Bell size={17} />}
        label="전체 알림"
        description="아래 모든 설정을 한 번에 켜거나 끕니다"
        checked={preferences.enabled}
        onChange={(value) => set("enabled", value)}
        strong
      />

      {!preferences.enabled && (
        <div style={warningStyle}>
          전체 알림이 꺼져 있어 아래 설정은 지금 적용되지 않습니다. 아래 값은 그대로 보관되며, 전체 알림을 다시 켜면 이 상태로 동작합니다.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
        <ChannelButton
          icon={<Smartphone size={18} />}
          label="휴대폰 푸시"
          description="상단 알림"
          checked={preferences.push_enabled}
          onChange={(value) => set("push_enabled", value)}
        />
        <ChannelButton
          icon={<Bell size={18} />}
          label="앱 내 팝업"
          description="화면 위 토스트"
          checked={preferences.in_app_enabled}
          onChange={(value) => set("in_app_enabled", value)}
        />
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", margin: "18px 0 6px" }}>알림 유형</div>
      <div>
        {NOTIFICATION_CATEGORIES.map((category) => {
          const key = `${category.key}_enabled` as `${NotificationCategory}_enabled`;
          return (
            <SwitchRow
              key={category.key}
              label={category.label}
              description={category.description}
              checked={preferences[key]}
              onChange={(value) => set(key, value)}
            />
          );
        })}
      </div>

      <div style={{ fontSize: 10.5, color: "var(--ink-faint)", lineHeight: 1.55, marginTop: 12 }}>
        휴대폰 자체 설정에서 스마트명성 알림 권한을 차단한 경우에는 푸시를 켜도 표시되지 않을 수 있습니다.
      </div>
      {status && <div role="status" style={{ marginTop: 9, fontSize: 11, fontWeight: 700, color: "var(--accent)", textAlign: "center" }}>{status}</div>}
    </div>
  );
}

function SwitchRow({ icon, label, description, checked, strong, onChange }: {
  icon?: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  strong?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--hairline)", cursor: "pointer" }}>
      {icon && <span style={{ color: "var(--accent)", display: "inline-flex" }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: strong ? 900 : 700, color: "var(--ink)" }}>{label}</span>
        <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2, lineHeight: 1.4 }}>{description}</span>
      </span>
      <StateLabel checked={checked} />
      <Toggle checked={checked} onChange={onChange} />
    </label>
  );
}

// 켜짐/꺼짐을 글자로도 표시한다. (흐린 색만으로는 꺼진 걸 알아채기 어려웠다)
function StateLabel({ checked }: { checked: boolean }) {
  return (
    <span style={{
      flexShrink: 0,
      fontSize: 10,
      fontWeight: 800,
      color: checked ? "var(--accent)" : "var(--danger)",
    }}>
      {checked ? "켜짐" : "꺼짐"}
    </span>
  );
}

function ChannelButton({ icon, label, description, checked, onChange }: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      style={{
        minHeight: 84, borderRadius: 11, padding: "10px 8px", cursor: "pointer",
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--danger)"}`,
        background: checked ? "var(--accent-soft)" : "var(--surface)", color: checked ? "var(--accent)" : "var(--danger)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit",
      }}
    >
      {icon}<strong style={{ fontSize: 12 }}>{label}</strong><span style={{ fontSize: 10 }}>{description} · {checked ? "켜짐" : "꺼짐"}</span>
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      style={{ width: 38, height: 21, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
    />
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--card)", borderRadius: 14, padding: 18, border: "1px solid var(--hairline)",
  boxShadow: "0 1px 4px rgba(43,39,34,0.04)", color: "var(--ink-soft)", fontSize: 12,
};

const embeddedStyle: React.CSSProperties = {
  padding: "14px 16px 18px", color: "var(--ink-soft)", fontSize: 12, background: "var(--surface)",
};

const enableAllButtonStyle: React.CSSProperties = {
  width: "100%", marginBottom: 12, padding: "9px 16px", borderRadius: 9,
  border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)",
  fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
};

const warningStyle: React.CSSProperties = {
  marginTop: 8, padding: "9px 11px", borderRadius: 9,
  background: "var(--warning-soft)", color: "var(--warning)",
  fontSize: 10.5, fontWeight: 700, lineHeight: 1.5,
};
