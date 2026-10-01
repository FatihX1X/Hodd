import type { Money } from "./models";

export function formatMoney(money: Money, options: { compact?: boolean; fractionDigits?: number } = {}) {
  const divisor = BigInt(10) ** BigInt(money.decimals);
  const raw = BigInt(money.minorUnits);
  const whole = raw / divisor;
  const fraction = raw % divisor;

  if (options.compact && whole >= BigInt(1_000)) {
    const compactValue = Number(whole) / 1_000;
    return `${compactValue.toLocaleString("en-US", { maximumFractionDigits: 1 })}K ${money.currency}`;
  }

  const fractionText = fraction.toString().padStart(money.decimals, "0").slice(0, options.fractionDigits ?? 2);
  const numberText = `${whole.toLocaleString("en-US")}.${fractionText}`;
  return `${numberText} ${money.currency}`;
}

export function formatDate(isoDate: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
    ...options,
  }).format(new Date(isoDate));
}

export function formatPercentFromBps(bps: number, fractionDigits = 0) {
  return `${(bps / 100).toFixed(fractionDigits)}%`;
}
