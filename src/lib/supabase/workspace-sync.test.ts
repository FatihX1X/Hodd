import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import { loadCloudWorkspace, syncWorkspaceToCloud } from "./workspace-sync";

const { client } = vi.hoisted(() => ({ client: { auth: { getUser: vi.fn() }, from: vi.fn() } }));
vi.mock("./client", () => ({ createSupabaseBrowserClient: () => client }));
beforeEach(() => { vi.clearAllMocks(); client.auth.getUser.mockResolvedValue({ data: { user: { id: "alice" } } }); });

describe("Workspace ownership", () => {
  it("does not upload a guest workspace when an authenticated session exists", async () => {
    await syncWorkspaceToCloud(initialWorkspace);
    expect(client.from).not.toHaveBeenCalled();
  });
  it("rejects reads and writes after the authenticated account changes", async () => {
    await expect(loadCloudWorkspace("bob")).rejects.toThrow("session changed");
    await expect(syncWorkspaceToCloud(initialWorkspace, "bob")).rejects.toThrow("session changed");
    expect(client.from).not.toHaveBeenCalled();
  });
  it("fails closed for unsupported cloud schemas", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { workspace: { schemaVersion: 99 } }, error: null }) };
    client.from.mockReturnValue(query);
    await expect(loadCloudWorkspace("alice")).rejects.toThrow("validation");
    expect(query.eq).toHaveBeenCalledWith("user_id", "alice");
  });
  it("surfaces a cloud read error rather than replacing cloud data", async () => {
    client.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } }) });
    await expect(loadCloudWorkspace("alice")).rejects.toThrow("could not be loaded");
  });
});
