import type { TreasuryWorkspace } from "@/lib/treasury/models";

/** Browser edits may survive offline, but they cannot override server payment facts. */
export function mergePaymentLedger(local: TreasuryWorkspace, cloud: TreasuryWorkspace): TreasuryWorkspace {
  const canonical = new Map(cloud.obligations.map((item) => [item.id, item]));
  const obligations = local.obligations.map((item) => {
    const server = canonical.get(item.id);
    if (server?.status === "PAID" || item.status === "PAID") return server ?? { ...item, status: "DRAFT" as const, paymentReference: null };
    return item;
  });
  for (const item of cloud.obligations) if (item.status === "PAID" && !obligations.some((localItem) => localItem.id === item.id)) obligations.push(item);
  return { ...local, obligations, pendingTransactions: cloud.pendingTransactions, paymentReservations: cloud.paymentReservations };
}
