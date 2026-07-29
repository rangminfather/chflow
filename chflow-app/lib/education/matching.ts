export interface MatchableMember {
  id: string;
  name: string;
  sub_role?: string | null;
}

export interface IdentityAlias {
  id: string;
  member_id: string;
  person_name_normalized: string;
  active: boolean;
}

export interface MemberMatchResult {
  status: "recommended" | "ambiguous" | "unmatched";
  suggestedMemberId: string | null;
  candidates: Array<{
    memberId: string;
    basis: "exact_name" | "verified_alias";
    score: number;
  }>;
}

function compact(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, "");
}

export function matchMemberByIdentity(
  normalizedName: string | null,
  members: MatchableMember[],
  aliases: IdentityAlias[] = [],
): MemberMatchResult {
  if (!normalizedName) {
    return { status: "unmatched", suggestedMemberId: null, candidates: [] };
  }
  const target = compact(normalizedName);
  const candidates = new Map<string, { memberId: string; basis: "exact_name" | "verified_alias"; score: number }>();

  for (const member of members) {
    if (compact(member.name) === target) {
      candidates.set(member.id, { memberId: member.id, basis: "exact_name", score: 90 });
    }
  }
  for (const alias of aliases) {
    if (!alias.active || compact(alias.person_name_normalized) !== target) continue;
    candidates.set(alias.member_id, { memberId: alias.member_id, basis: "verified_alias", score: 100 });
  }

  const list = [...candidates.values()].sort((a, b) => b.score - a.score || a.memberId.localeCompare(b.memberId));
  return {
    status: list.length === 1 ? "recommended" : list.length > 1 ? "ambiguous" : "unmatched",
    suggestedMemberId: list.length === 1 ? list[0].memberId : null,
    candidates: list,
  };
}

