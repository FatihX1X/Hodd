import { expect, type Page } from "@playwright/test";
import { createLiveStarterWorkspace } from "../../src/lib/treasury/starter";
import type { TreasuryWorkspace } from "../../src/lib/treasury/models";

/** All identity and workspace requests are intercepted; no hosted state changes. */
export async function liveSession(page: Page, initial: TreasuryWorkspace | null = null) {
  const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ui-test@example.test", created_at: "2026-10-09T12:00:00.000Z", app_metadata: {}, user_metadata: {} };
  let workspace = initial;
  let revision = 0;
  let authOrigin = "";
  let rejectDeletion = false;
  // Browser fixtures stay in the browser. Server routes receive no test identity.
  await page.route("http://127.0.0.1:3107/**", async (route) => {
    const headers = { ...route.request().headers() }; delete headers.cookie;
    await route.continue({ headers });
  });
  await page.route("**/auth/v1/**", async (route) => {
    authOrigin = new URL(route.request().url()).origin;
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(path.endsWith("/user") ? user : {}) });
  });
  await page.route("**/rest/v1/**", async (route) => {
    const table = new URL(route.request().url()).pathname.split("/").at(-1);
    if (table === "treasury_workspaces") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { workspace: TreasuryWorkspace };
        if (rejectDeletion && workspace && body.workspace.obligations.length < workspace.obligations.length) {
          await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "obligation deletion is not supported" }) }); return;
        }
        workspace = body.workspace; revision++;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision }) }); return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace ? { workspace, revision } : null) }); return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  // Discover the configured public auth origin through an intercepted OTP request.
  await page.goto("/login"); await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByText("Check your email to continue.")).toBeVisible();
  const project = new URL(authOrigin).hostname.split(".")[0];
  const payload = { sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iss: `${authOrigin}/auth/v1` };
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test-signature`;
  const session = { access_token: token, refresh_token: "ui-test-refresh", token_type: "bearer", expires_in: 3600, expires_at: payload.exp, user };
  await page.context().addCookies([{ name: `sb-${project}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3107" }]);
  return { getWorkspace: () => workspace ?? createLiveStarterWorkspace(), getWriteCount: () => revision, rejectDeletion: () => { rejectDeletion = true; } };
}
