import { z } from "zod";
import { policyResultSchema, walletConnectionSchema } from "@/lib/treasury/models";
import { arcAddressSchema, usdcMoneySchema } from "@/lib/earn/models";
import { walletFeeQuoteSchema } from "@/lib/wallet/fee-quote";
export const paymentStateSchema = z.enum(["REVIEW_REQUIRED", "AWAITING_SIGNATURE", "SUBMITTED", "CONFIRMED", "FAILED", "CANCELLED", "EXPIRED", "UNKNOWN"]);
export const paymentProposalSchema = z.object({
  id: z.string().uuid(), obligationId: z.string(), obligationRevision: z.number().int().positive(),
  scope: z.enum(["TREASURY", "SMOKE_TEST"]), wallet: walletConnectionSchema,
  recipientAddress: arcAddressSchema, recipientLabel: z.string().nullable(), amount: usdcMoneySchema,
  feeReserve: usdcMoneySchema, balanceAfter: usdcMoneySchema, gasBudgetWei: z.string().regex(/^\d+$/),
  feeQuote: walletFeeQuoteSchema.nullable().optional(),
  policy: policyResultSchema, expiresAt: z.string().datetime(), startBlock: z.string().regex(/^\d+$/),
  executionEnabled: z.boolean(), executionReason: z.string(),
});
export const paymentRecordSchema = z.object({ id: z.string().uuid(), state: paymentStateSchema, proposal: paymentProposalSchema, txHash: z.string().regex(/^0x[\da-fA-F]{64}$/).nullable(), userOperationHash: z.string().regex(/^0x[\da-fA-F]{64}$/).nullable(), receipt: z.object({ blockNumber: z.string().regex(/^\d+$/), logIndex: z.number().int().nonnegative(), networkFee: usdcMoneySchema }).nullable() });
export const paymentRequestSchema = z.object({ scope: z.enum(["TREASURY", "SMOKE_TEST"]).default("TREASURY"), action: z.enum(["REVIEW", "CONFIRM", "STATUS", "RECHECK", "REPLY", "RECOVER"]), obligationId: z.string().max(128).optional(), proposalId: z.string().uuid().optional(), confirmed: z.literal(true).optional(), requestId: z.string().uuid().optional(), txHash: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(), userOperationHash: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(), cancelled: z.boolean().optional(), uncertain: z.boolean().optional(), challengeApproved: z.literal(true).optional(), acknowledgeNoPendingTransaction: z.literal(true).optional() }).strict();
export const paymentResponseSchema = z.union([z.object({ status: z.literal("READY"), record: paymentRecordSchema, pending: z.object({ id: z.string().uuid(), calls: z.array(z.object({ to: arcAddressSchema, data: z.string().regex(/^0x[\da-fA-F]*$/), value: z.string().regex(/^\d+$/) })), gasBudgetWei: z.string(), gasCeiling: z.object({ gasLimit: z.string().regex(/^\d+$/), gasPriceWei: z.string().regex(/^\d+$/) }).optional(), challengeId: z.string().optional(), expiresAt: z.string().datetime().optional() }).nullable() }), z.object({ status: z.literal("ERROR"), message: z.string(), code: z.string() })]);
export type PaymentProposal = z.infer<typeof paymentProposalSchema>;
export type PaymentRecord = z.infer<typeof paymentRecordSchema>;
export const paymentEventSchema = z.object({ id: z.coerce.string(), proposal_id: z.string().uuid(), stage: z.union([paymentStateSchema, z.enum(["USER_CONFIRMED", "USER_OPERATION_SUBMITTED", "PIN_APPROVAL_REQUESTED", "PIN_APPROVED", "PIN_REJECTED"])]), kind: z.enum(["LOCAL_AUDIT", "ONCHAIN_RECEIPT"]), tx_hash: z.string().regex(/^0x[\da-fA-F]{64}$/).nullable(), occurred_at: z.string().datetime({ offset: true }) });
export type PaymentEvent = z.infer<typeof paymentEventSchema>;
