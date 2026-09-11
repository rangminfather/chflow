export interface MonthlyPlanFileInfo {
  year: number | null;
  month: number | null;
  months: number[];
  originalName: string;
}

export function parseMonthlyPlanName(name: string): MonthlyPlanFileInfo {
  const match = name.match(/^(\d{4})-(\d{2}(?:\+\d{2})*)_(\d+)_monthly-plan(?:\.[a-z0-9]+)?$/);
  if (!match) return { year: null, month: null, months: [], originalName: name };
  const months = match[2].split("+").map(Number).filter((month) => month >= 1 && month <= 12);
  return {
    year: Number(match[1]),
    month: months[0] ?? null,
    months,
    originalName: `${Number(match[1])}년 ${months.map((month) => `${month}월`).join("·")} 월간 교육계획서`,
  };
}

export function monthlyPlanMonthToken(months: number[]) {
  return months.map((month) => String(month).padStart(2, "0")).join("+");
}
