"use client";
import { useEffect, useState } from "react";

export function useTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("chflow-theme");
    if (saved === "dark") {
      setIsDark(true);
    } else if (saved === "light") {
      setIsDark(false);
    } else {
      setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    const val = next ? "dark" : "light";
    localStorage.setItem("chflow-theme", val);
    document.documentElement.setAttribute("data-theme", val);
  };

  return { isDark, toggle };
}
