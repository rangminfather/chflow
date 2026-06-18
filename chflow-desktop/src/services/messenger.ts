// 메신저 서비스 결선 — 싱글톤 클라이언트로 API + Realtime 매니저 1개씩 생성.
import { supabase } from "./supabase";
import { createMessengerApi } from "@shared/messenger-api";
import { RealtimeManager } from "./realtime";

export const messengerApi = createMessengerApi(supabase);
export const realtime = new RealtimeManager(supabase);
