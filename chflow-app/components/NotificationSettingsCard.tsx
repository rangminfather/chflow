"use client";

import { useEffect, useState } from "react";
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

export default function NotificationSettingsCard({ onSaved }: { onSaved?: (message: string) => void }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchNotificationPreferences().then((value) => {
      setPreferences(value);
      setLoading(false);
    });
  }, []);

  const set = <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      if (preferences.enabled && preferences.push_enabled) {
        await requestNotificationPermission();
      }
      await saveNotificationPreferences(preferences);
      window.dispatchEvent(new CustomEvent("chflow:notification-preferences-changed", { detail: preferences }));
      onSaved?.("알림 설정이 저장되었습니다");
    } catch (error) {
      const message = error instanceof Error ? error.message : "알림 설정을 저장하지 못했습니다";
      onSaved?.(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div id="notification-settings" style={cardStyle}>알림 설정을 불러오는 중...</div>;
  }

  const detailDisabled = !preferences.enabled;

  return (
    <div id="notification-settings" style={{ ...cardStyle, scrollMarginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <BellRing size={18} color="var(--accent)" />
        <strong style={{ fontSize: 14, color: "var(--ink)" }}>알림 설정</strong>
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5, marginBottom: 14 }}>
        휴대폰 상단 푸시와 앱 안의 알림 표시를 각각 설정할 수 있습니다.
      </div>

      <SwitchRow
        icon={<Bell size={17} />}
        label="전체 알림"
        description="모든 휴대폰·앱 내 알림을 한 번에 켜거나 끕니다"
        checked={preferences.enabled}
        onChange={(value) => set("enabled", value)}
        strong
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10, opacity: detailDisabled ? 0.5 : 1 }}>
        <ChannelButton
          icon={<Smartphone size={18} />}
          label="휴대폰 푸시"
          description="상단 알림"
          checked={preferences.push_enabled}
          disabled={detailDisabled}
          onChange={(value) => set("push_enabled", value)}
        />
        <ChannelButton
          icon={<Bell size={18} />}
          label="앱 내 알림"
          description="종·배지·팝업"
          checked={preferences.in_app_enabled}
          disabled={detailDisabled}
          onChange={(value) => set("in_app_enabled", value)}
        />
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", margin: "18px 0 6px" }}>알림 유형</div>
      <div style={{ opacity: detailDisabled ? 0.5 : 1 }}>
        {NOTIFICATION_CATEGORIES.map((category) => {
          const key = `${category.key}_enabled` as `${NotificationCategory}_enabled`;
          return (
            <SwitchRow
              key={category.key}
              label={category.label}
              description={category.description}
              checked={preferences[key]}
              disabled={detailDisabled}
              onChange={(value) => set(key, value)}
            />
          );
        })}
      </div>

      <div style={{ fontSize: 10.5, color: "var(--ink-faint)", lineHeight: 1.55, marginTop: 10 }}>
        휴대폰 자체 설정에서 스마트명성 알림 권한을 차단한 경우에는 푸시를 켜도 표시되지 않을 수 있습니다.
      </div>
      <button type="button" onClick={save} disabled={saving} style={saveButtonStyle}>
        {saving ? "저장 중..." : "알림 설정 저장"}
      </button>
    </div>
  );
}

function SwitchRow({ icon, label, description, checked, disabled, strong, onChange }: {
  icon?: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  strong?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--hairline)", cursor: disabled ? "default" : "pointer" }}>
      {icon && <span style={{ color: "var(--accent)", display: "inline-flex" }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: strong ? 900 : 700, color: "var(--ink)" }}>{label}</span>
        <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2, lineHeight: 1.4 }}>{description}</span>
      </span>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

function ChannelButton({ icon, label, description, checked, disabled, onChange }: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        minHeight: 84, borderRadius: 11, padding: "10px 8px", cursor: disabled ? "default" : "pointer",
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--hairline-strong)"}`,
        background: checked ? "var(--accent-soft)" : "var(--surface)", color: checked ? "var(--accent)" : "var(--ink-soft)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit",
      }}
    >
      {icon}<strong style={{ fontSize: 12 }}>{label}</strong><span style={{ fontSize: 10 }}>{description} · {checked ? "ON" : "OFF"}</span>
    </button>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      style={{ width: 38, height: 21, accentColor: "var(--accent)", cursor: disabled ? "default" : "pointer", flexShrink: 0 }}
    />
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--card)", borderRadius: 14, padding: 18, border: "1px solid var(--hairline)",
  boxShadow: "0 1px 4px rgba(43,39,34,0.04)", color: "var(--ink-soft)", fontSize: 12,
};

const saveButtonStyle: React.CSSProperties = {
  width: "100%", marginTop: 14, padding: "11px 16px", border: "none", borderRadius: 9,
  background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
};
