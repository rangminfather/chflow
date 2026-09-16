import { createLucideIcon } from "lucide-react";

// UTH-170WF WiFi 온열패널 조절기 형상 아이콘 (lucide 호환: size/color/strokeWidth 전달됨)
const UthIcon = createLucideIcon("UthPanel", [
  ["rect", { x: "5", y: "2.5", width: "14", height: "19", rx: "2.4", key: "body" }],
  ["rect", { x: "7.6", y: "4.8", width: "8.8", height: "6", rx: "1.2", key: "disp" }],
  ["path", { d: "M9.8 7.8h2.4", key: "num" }],
  ["circle", { cx: "14.2", cy: "6.7", r: "0.75", fill: "currentColor", stroke: "none", key: "deg" }],
  ["path", { d: "M9.4 14a3.6 3.6 0 0 1 5.2 0", key: "wifi1" }],
  ["path", { d: "M10.9 15.6a1.6 1.6 0 0 1 2.2 0", key: "wifi2" }],
  ["path", { d: "M12 17.4v2.1", key: "pw1" }],
  ["path", { d: "M10.5 17.9a2.1 2.1 0 1 0 3 0", key: "pw2" }],
]);

export default UthIcon;
