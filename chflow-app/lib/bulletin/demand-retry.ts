import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function claimBulletinDemandRetry(source: string, issueDate: string) {
  const { data, error } = await adminClient().rpc("claim_bulletin_demand_retry", {
    p_source: source,
    p_issue_date: issueDate,
    p_cooldown_minutes: 30,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function finishBulletinDemandRetry(
  source: string,
  issueDate: string,
  status: "success" | "not_available" | "error",
) {
  const { error } = await adminClient().rpc("finish_bulletin_demand_retry", {
    p_source: source,
    p_issue_date: issueDate,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}
