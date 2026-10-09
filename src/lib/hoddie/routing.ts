import "server-only";
import { HoddieError, type HoddieProvider } from "./models";
import { parseIntent, providerAvailability } from "./provider";

/** Only masked intent parsing may fall back. Quota, consent and financial errors never do. */
export async function parseAutomaticIntent(
  command: string,
  hasSelection: boolean,
  reserve: (provider: HoddieProvider) => Promise<void>,
  signal?: AbortSignal,
) {
  const candidates = providerAvailability().filter((item) => item.ready);
  if (!candidates.length) throw new HoddieError("PROVIDER_NOT_CONFIGURED", "Hoddie is awaiting a free command provider's server configuration.", 503);
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    // Each attempted provider gets its own atomic reservation, including NVIDIA's daily cap.
    await reserve(candidate.id);
    try {
      const intent = await parseIntent(candidate.id, command, hasSelection, signal);
      return { intent, provider: candidate.id };
    } catch (error) {
      if (signal?.aborted || !(error instanceof HoddieError) || !["MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "PROVIDER_NOT_CONFIGURED"].includes(error.code)) throw error;
      // At most Gemini once, then the pinned free NVIDIA endpoint once. No loops/retries.
    }
  }
  throw new HoddieError("MODEL_UNAVAILABLE", "Hoddie could not interpret this command with its available free providers. Nothing was applied. Please try later.", 503);
}
