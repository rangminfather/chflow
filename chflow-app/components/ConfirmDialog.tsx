"use client";

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import ModalBackdrop from "./ModalBackdrop";

type ModalType = "confirm" | "prompt" | "alert";

interface ModalConfig {
  type: ModalType;
  message: string;
  defaultValue?: string;
  resolve: (value: string | boolean | null) => void;
}

const ConfirmCtx = createContext<{
  confirm: (msg: string) => Promise<boolean>;
  prompt: (msg: string, defaultValue?: string) => Promise<string | null>;
  alert: (msg: string) => Promise<void>;
} | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(
    (cfg: Omit<ModalConfig, "resolve">): Promise<string | boolean | null> =>
      new Promise((resolve) => {
        if (cfg.type === "prompt") setInputVal(cfg.defaultValue ?? "");
        setModal({ ...cfg, resolve });
      }),
    []
  );

  const confirm = useCallback(
    (msg: string) => open({ type: "confirm", message: msg }) as Promise<boolean>,
    [open]
  );
  const prompt = useCallback(
    (msg: string, defaultValue = "") =>
      open({ type: "prompt", message: msg, defaultValue }) as Promise<string | null>,
    [open]
  );
  const alert = useCallback(
    (msg: string) => open({ type: "alert", message: msg }).then(() => undefined),
    [open]
  );

  const handleOk = () => {
    if (!modal) return;
    if (modal.type === "prompt") modal.resolve(inputVal);
    else if (modal.type === "confirm") modal.resolve(true);
    else modal.resolve(null);
    setModal(null);
  };

  const handleCancel = () => {
    if (!modal) return;
    if (modal.type === "confirm") modal.resolve(false);
    else modal.resolve(null);
    setModal(null);
  };

  return (
    <ConfirmCtx.Provider value={{ confirm, prompt, alert }}>
      {children}
      {modal && (
        <ModalBackdrop
          onClose={modal.type === "alert" ? handleOk : handleCancel}
          style={{ zIndex: 9000 }}
        >
          <div
            style={{
              background: "var(--card)",
              borderRadius: 16,
              padding: "24px 24px 20px",
              width: "min(320px, calc(100vw - 48px))",
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            <p
              style={{
                fontSize: 14,
                color: "var(--ink)",
                lineHeight: 1.75,
                marginBottom: modal.type === "prompt" ? 14 : 22,
                whiteSpace: "pre-line",
                wordBreak: "keep-all",
              }}
            >
              {modal.message}
            </p>
            {modal.type === "prompt" && (
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleOk(); }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1.5px solid var(--hairline)",
                  borderRadius: 8,
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                  marginBottom: 16,
                  color: "var(--ink)",
                  background: "var(--surface)",
                }}
              />
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {modal.type !== "alert" && (
                <button onClick={handleCancel} style={cancelStyle}>
                  취소
                </button>
              )}
              <button onClick={handleOk} style={okStyle}>
                확인
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be inside ConfirmProvider");
  return ctx;
}

const cancelStyle: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: 8,
  border: "1.5px solid var(--hairline)",
  background: "transparent",
  color: "var(--ink-mid)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const okStyle: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};
