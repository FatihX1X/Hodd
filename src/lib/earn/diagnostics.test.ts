import { describe, expect, it } from "vitest";
import { safeEarnFailure } from "./diagnostics";

describe("secret-free Earn diagnostics", () => {
  it("extracts Circle's numeric code from App Kit's actual validation trace", () => {
    const error = { code: 1098, message: "secret-provider-message", cause: { trace: { field: "circle-api", value: { operation: "createUserTransactionContractExecutionChallenge", status: 400, circleCode: 155232 }, reason: "secret-provider-reason" } } };
    expect(safeEarnFailure(error, "CHALLENGE_CREATION")).toEqual({ code: "SDK_FAILURE", stage: "CHALLENGE_CREATION", providerCode: "155232" });
    expect(JSON.stringify(safeEarnFailure(error, "CHALLENGE_CREATION"))).not.toContain("secret-");
  });
  it("drops raw messages, credentials and SDK request context", () => {
    const secret = "secret-do-not-disclose";
    const failure = safeEarnFailure({ message: secret, code: secret, request: { headers: { authorization: secret } }, cause: { trace: { response: { data: { code: 155104, message: secret } } } } }, "CHALLENGE_CREATION");
    expect(failure).toEqual({ code: "SDK_FAILURE", stage: "CHALLENGE_CREATION", providerCode: "155104" });
    expect(JSON.stringify(failure)).not.toContain(secret);
  });
  it("retains only known local codes and tolerates cycles", () => {
    const error = new Error("FRESH_POLICY_BLOCKED"); error.cause = error;
    expect(safeEarnFailure(error, "EARN_SDK")).toEqual({ code: "FRESH_POLICY_BLOCKED", stage: "EARN_SDK" });
  });
});
