export type PastureExploreSortRow = {
  pasture_name: string;
  grassland_name: string | null;
  plain_name: string | null;
  pasture_order: number;
  grassland_order: number;
  plain_order: number;
};

const UNASSIGNED_NAMES = new Set(["미정", "미지정"]);

function normalizedDirectoryName(value: string | null | undefined): string {
  return (value || "").trim().replace(/^\((.*)\)$/, "$1").trim();
}

export function isPastureExplorePlaceholder(
  row: Pick<PastureExploreSortRow, "pasture_name" | "grassland_name" | "plain_name">,
): boolean {
  return [row.pasture_name, row.grassland_name, row.plain_name]
    .some((value) => UNASSIGNED_NAMES.has(normalizedDirectoryName(value).replace(/평원$|초원$|목장$/, "")));
}

function plainExploreRank(row: PastureExploreSortRow): number {
  const name = normalizedDirectoryName(row.plain_name);
  const numeric = name.match(/^(\d+)평원$/);
  if (numeric) return Number(numeric[1]);
  if (name === "젊은이평원") return 1_000_000;
  return 100_000 + row.plain_order;
}

export function sortPastureExploreRows<T extends PastureExploreSortRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    plainExploreRank(a) - plainExploreRank(b)
    || a.plain_order - b.plain_order
    || a.grassland_order - b.grassland_order
    || (a.grassland_name || "").localeCompare(b.grassland_name || "", "ko-KR")
    || a.pasture_order - b.pasture_order
    || a.pasture_name.localeCompare(b.pasture_name, "ko-KR", { numeric: true })
  );
}
