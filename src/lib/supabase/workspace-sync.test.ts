import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/test/fixtures";
import { loadCloudWorkspace, refreshCloudLedger, syncWorkspaceToCloud } from "./workspace-sync";

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
  it("refreshes canonical facts without uploading a stale workspace", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { workspace: initialWorkspace }, error: null }), upsert: vi.fn() };
    client.from.mockReturnValue(query);
    expect(await refreshCloudLedger("alice", "SMOKE_TEST")).toEqual(initialWorkspace);
    expect(client.from).toHaveBeenCalledWith("earn_smoke_workspaces"); expect(query.upsert).not.toHaveBeenCalled();
  });
  it("discards a canonical read if the signed-in user changes while it is in flight", async () => {
    client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: "alice" } } }).mockResolvedValueOnce({ data: { user: { id: "bob" } } });
    client.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { workspace: initialWorkspace }, error: null }) });
    await expect(refreshCloudLedger("alice", "TREASURY")).rejects.toThrow("session changed");
  });
});
