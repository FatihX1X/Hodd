import { z } from "zod";
import { paymentRecordSchema } from "@/lib/payments/models";
import { burnIntentSchema } from "./intent";

export const gatewayPaymentResponseSchema = z.union([
  z.object({
    status: z.literal("READY"), record: paymentRecordSchema, pending: z.null(),
    gateway: z.object({ sign: z.object({ id: z.string().uuid(), typedData: z.record(z.string(), z.unknown()), intent: burnIntentSchema, expiresAt: z.string().datetime() }).nullable(), transferId: z.string().uuid().nullable(), signed: z.boolean() }),
  }),
  z.object({ status: z.literal("ERROR"), code: z.string(), message: z.string() }),
]);
export type GatewayPaymentResponse = z.infer<typeof gatewayPaymentResponseSchema>;
