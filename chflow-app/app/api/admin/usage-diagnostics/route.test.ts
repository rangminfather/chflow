import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { GET } from "./route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

type RpcError = { code: string; message: string; details: string; hint: string };

function request(token?: string) {
  return {
    headers: new Headers(token ? { Authorization: `Bearer ${token}` } : undefined),
  } as Parameters<typeof GET>[0];
}

function mockClient(options: {
  authenticated?: boolean;
  rpcData?: Record<string, unknown> | null;
  rpcError?: RpcError | null;
}) {
  const getUser = vi.fn().mockResolvedValue(
    options.authenticated
      ? { data: { user: { id: "user-id" } }, error: null }
      : { data: { user: null }, error: { message: "invalid token" } },
  );
  const rpc = vi.fn().mockResolvedValue({
    data: options.rpcData ?? null,
    error: options.rpcError ?? null,
  });
  vi.mocked(createClient).mockReturnValue({ auth: { getUser }, rpc } as never);
  return { getUser, rpc };
}

describe("GET /api/admin/usage-diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request without a bearer token", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token", async () => {
    mockClient({ authenticated: false });
    const response = await GET(request("invalid"));
    expect(response.status).toBe(401);
  });

  it.each(["teacher", "parent", "empty role", "missing profile", "NULL role"])(
    "returns a generic forbidden error for %s",
    async () => {
      mockClient({
        authenticated: true,
        rpcError: {
          code: "42501",
          message: "usage_diagnostics_forbidden",
          details: "",
          hint: "",
        },
      });
      const response = await GET(request("user-token"));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "usage_diagnostics_forbidden" });
    },
  );

  it.each(["admin", "office", "pastor"])("returns diagnostics for %s", async () => {
    mockClient({ authenticated: true, rpcData: { latest_complete: null } });
    const response = await GET(request("admin-token"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ latest_complete: null });
  });

  it.each(["42883", "PGRST202"])("keeps the migration-required response stable for %s", async (code) => {
    mockClient({
      authenticated: true,
      rpcError: {
        code,
        message: "internal function name must not be returned",
        details: "internal schema detail",
        hint: "internal hint",
      },
    });
    const response = await GET(request("admin-token"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "usage_diagnostics_migration_required" });
  });

  it("does not expose internal database errors to the client or server log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockClient({
      authenticated: true,
      rpcError: {
        code: "XX000",
        message: "relation secret_internal_table failed: select * from private.schema",
        details: "SQL text and schema details",
        hint: "secret hint",
      },
    });

    const response = await GET(request("admin-token"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "usage_diagnostics_failed" });
    expect(log).toHaveBeenCalledWith("[usage-diagnostics] RPC failed", { code: "XX000" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret_internal_table");
    log.mockRestore();
  });
});
