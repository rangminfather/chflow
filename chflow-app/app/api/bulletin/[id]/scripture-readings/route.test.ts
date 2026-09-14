import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { GET } from "./route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

function request(token = "member-token") {
  return { headers: new Headers({ Authorization: `Bearer ${token}` }) } as Parameters<typeof GET>[0];
}

function context(id = "bulletin-id") { return { params: Promise.resolve({ id }) }; }

function mockClient(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  vi.mocked(createClient).mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "member-id" } } }) },
    from: vi.fn().mockReturnValue(query),
  } as never);
  return { query };
}

describe("GET /api/bulletin/[id]/scripture-readings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty successful response only when the deployed table is missing", async () => {
    mockClient({ data: null, error: { code: "PGRST205", message: "missing table" } });
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, readings: [] });
  });

  it("preserves the existing successful response for a normal query", async () => {
    const readings = [{ id: "reading-id", service_type: "sunday_morning" }];
    mockClient({ data: readings, error: null });
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, readings });
  });

  it("does not hide database errors other than PGRST205", async () => {
    mockClient({ data: null, error: { code: "42501", message: "permission denied" } });
    const response = await GET(request(), context());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "permission denied" });
  });
});
