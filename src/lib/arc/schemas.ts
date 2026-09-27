import { z } from "zod";
import { walletSnapshotSchema } from "@/lib/treasury/models";

export const walletAddressInputSchema = z.string().trim().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid EVM wallet address");
export const walletSnapshotResponseSchema = z.object({ status: z.literal("READY"), snapshot: walletSnapshotSchema });
export const walletErrorResponseSchema = z.object({
  status: z.literal("ERROR"),
  code: z.enum(["INVALID_ADDRESS", "WRONG_CHAIN", "INVALID_USDC", "RPC_UNAVAILABLE", "INVALID_RESPONSE"]),
  message: z.string(),
});
export const walletApiResponseSchema = z.union([walletSnapshotResponseSchema, walletErrorResponseSchema]);

export type WalletApiResponse = z.infer<typeof walletApiResponseSchema>;
