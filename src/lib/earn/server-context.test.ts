import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/circle/user-wallet-server", () => ({ boundUserToken: vi.fn(), circleUserWalletClient: vi.fn() }));
import { assertEarnContextCurrent, earnServerContext } from "./server-context";

describe("Earn server context", () => {
  beforeEach(() => mocks.client.mockReset());

  // Signed-out requests used to call hodd_earn_session_active as anon (42501 in the database log).
  it("rejects a signed-out request without asking the database about a session", async () => {
    const rpc = vi.fn(); const from = vi.fn();
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: { message: "Auth session missing" } }), getClaims: async () => ({ data: null }) }, rpc, from });
    await expect(earnServerContext()).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });

  it("rejects a changed session before the session check", async () => {
    const rpc = vi.fn(); const from = vi.fn();
    const client = { auth: { getUser: async () => ({ data: { user: { id: "other" } }, error: null }) }, rpc, from };
    await expect(assertEarnContextCurrent({ client, userId: "owner" } as never)).rejects.toMatchObject({ code: "SESSION_OR_WORKSPACE_CHANGED" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
