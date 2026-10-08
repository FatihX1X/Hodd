import { describe, expect, it } from "vitest";
import { safeAfterLogin } from "./after-login";

describe("post-login resume", () => {
  it("resumes only the OAuth consent screen", () => {
    expect(safeAfterLogin(encodeURIComponent("/oauth/consent?authorization_id=abc-123_XYZ"))).toBe("/oauth/consent?authorization_id=abc-123_XYZ");
    for (const value of ["//evil.example", "https://evil.example", "/invest", "/oauth/consent?authorization_id=x&next=//evil", "/oauth/consent?authorization_id=<script>", "%E0%A4%A", "", null]) expect(safeAfterLogin(value)).toBeNull();
  });
});
