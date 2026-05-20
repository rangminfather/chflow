import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "icn1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MEMBER_REVIEW_MODEL || "gpt-5.4-mini";

type RunBody = {
  member_id?: string;
  evidence_image_url?: string;
  evidence_note?: string;
};

type AiExtract = {
  name: string | null;
  sub_role: string | null;
  family_church: string | null;
  spouse_name: string | null;
  phone: string | null;
  home_phone: string | null;
  confidence: number;
  warnings: string[];
  recommendation: string;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function requireAdmin(req: NextRequest) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: jsonError("Unauthenticated", 401) };

  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return { error: jsonError("Invalid token", 401) };

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile) return { error: jsonError("Profile lookup failed", 500) };
  if (!["admin", "office", "pastor"].includes(profile.role)) {
    return { error: jsonError("Admin permission required", 403) };
  }

  return { admin, userId: authData.user.id };
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function outputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const record = block as { text?: unknown; type?: unknown };
      if (typeof record.text === "string") parts.push(record.text);
    }
  }
  return parts.join("\n").trim();
}

function parseAiJson(response: Record<string, unknown>): AiExtract {
  const text = outputText(response);
  if (!text) throw new Error("AI response did not contain text output");
  const parsed = JSON.parse(text) as Partial<AiExtract>;
  return {
    name: parsed.name ?? null,
    sub_role: parsed.sub_role ?? null,
    family_church: parsed.family_church ?? null,
    spouse_name: parsed.spouse_name ?? null,
    phone: parsed.phone ?? null,
    home_phone: parsed.home_phone ?? null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    recommendation: parsed.recommendation ? String(parsed.recommendation) : "needs_review",
  };
}

async function runOpenAi(member: Record<string, unknown>, evidenceUrl: string): Promise<{ extract: AiExtract; raw: unknown }> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: ["string", "null"] },
      sub_role: { type: ["string", "null"] },
      family_church: { type: ["string", "null"] },
      spouse_name: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
      home_phone: { type: ["string", "null"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      warnings: { type: "array", items: { type: "string" } },
      recommendation: {
        type: "string",
        enum: ["safe", "needs_review", "ambiguous", "no_match"],
      },
    },
    required: [
      "name",
      "sub_role",
      "family_church",
      "spouse_name",
      "phone",
      "home_phone",
      "confidence",
      "warnings",
      "recommendation",
    ],
  };

  const prompt = [
    "You are reviewing a Korean church directory crop against one existing database member.",
    "Extract only text that is visibly present in the image.",
    "If a field is uncertain, return null and add a warning.",
    "Do not infer a spouse-adjacent role as this member's role.",
    "Keep Korean role terms exactly as printed, such as 시무집사, 서리집사, 은퇴권사, 명예집사, 시무권사, 시무장로.",
    "Return JSON only.",
    "",
    `Database member snapshot: ${JSON.stringify(member)}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "You extract structured Korean directory fields from member evidence images for human review. Be conservative.",
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: evidenceUrl },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "member_directory_extract",
          strict: true,
          schema,
        },
      },
    }),
  });

  const raw = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const detail = JSON.stringify(raw).slice(0, 500);
    throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
  }

  return { extract: parseAiJson(raw), raw };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  if (!body.member_id) return jsonError("member_id is required", 400);
  if (!body.evidence_image_url) return jsonError("evidence_image_url is required", 400);
  const evidenceUrl = normalizeUrl(body.evidence_image_url);
  if (!evidenceUrl) return jsonError("evidence_image_url must be http(s)", 400);

  const { data: member, error: memberError } = await auth.admin
    .from("members")
    .select("id,name,phone,home_phone,family_church,sub_role,spouse_name,source_page,status,is_child")
    .eq("id", body.member_id)
    .maybeSingle();

  if (memberError) return jsonError(memberError.message, 500);
  if (!member) return jsonError("Member not found", 404);

  try {
    const { extract, raw } = await runOpenAi(member, evidenceUrl);
    const { data: inserted, error: insertError } = await auth.admin
      .from("ai_member_review_candidates")
      .insert({
        member_id: member.id,
        evidence_image_url: evidenceUrl,
        evidence_note: body.evidence_note || null,
        model: OPENAI_MODEL,
        db_name: member.name,
        db_sub_role: member.sub_role,
        db_family_church: member.family_church,
        db_spouse_name: member.spouse_name,
        db_phone: member.phone,
        db_home_phone: member.home_phone,
        db_source_page: member.source_page,
        ai_name: extract.name,
        ai_sub_role: extract.sub_role,
        ai_family_church: extract.family_church,
        ai_spouse_name: extract.spouse_name,
        ai_phone: extract.phone,
        ai_home_phone: extract.home_phone,
        ai_confidence: extract.confidence,
        ai_warnings: extract.warnings,
        recommendation: extract.recommendation,
        raw_response: raw,
        created_by: auth.userId,
      })
      .select("id")
      .single();

    if (insertError) return jsonError(insertError.message, 500);
    return NextResponse.json({ ok: true, candidate_id: inserted.id, data: extract });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI review failed";
    await auth.admin.from("ai_member_review_candidates").insert({
      member_id: member.id,
      evidence_image_url: evidenceUrl,
      evidence_note: body.evidence_note || null,
      model: OPENAI_MODEL,
      status: "error",
      db_name: member.name,
      db_sub_role: member.sub_role,
      db_family_church: member.family_church,
      db_spouse_name: member.spouse_name,
      db_phone: member.phone,
      db_home_phone: member.home_phone,
      db_source_page: member.source_page,
      ai_confidence: 0,
      ai_warnings: [message],
      recommendation: "needs_review",
      created_by: auth.userId,
    });
    return jsonError(message, message.includes("OPENAI_API_KEY") ? 500 : 502);
  }
}
