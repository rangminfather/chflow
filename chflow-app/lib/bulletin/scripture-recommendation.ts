import { detectWorshipSession } from "@/lib/worshipSchedule";
import type { BulletinServiceType } from "./scripture-parser";

export function getRecommendedBulletinService(at = new Date()): BulletinServiceType | null {
  switch (detectWorshipSession(at)?.key) {
    case "sun_2": case "sun_3": return "sunday_morning";
    case "sun_4": return "sunday_afternoon";
    case "wed_am": return "wednesday_morning";
    case "wed_pm": return "wednesday_evening";
    default: return null;
  }
}
