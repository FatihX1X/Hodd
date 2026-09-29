import type { Money } from "@/lib/treasury/models";

export type UsdcMoney = Readonly<{ currency: "USDC"; decimals: 6; minorUnits: string }>;

const POWERS = Array.from({ length: 19 }, (_, index) => 10n ** BigInt(index));

export function decimalStringToMoney(value: string, decimals: 6 = 6, allowNegative = false): UsdcMoney {
  const pattern = allowNegative ? /^(-?)(\d+)(?:\.(\d+))?$/ : /^(\d+)(?:\.(\d+))?$/;
  const match = value.trim().match(pattern);
  if (!match) throw new Error("Invalid decimal amount");
  const negative = allowNegative && match[1] === "-";
  const whole = allowNegative ? match[2] : match[1];
  const fraction = (allowNegative ? match[3] : match[2]) ?? "";
  if (fraction.length > decimals) throw new Error(`Amount exceeds ${decimals} decimal places`);
  const raw = BigInt(`${whole}${fraction.padEnd(decimals, "0")}` || "0");
  return { currency: "USDC", decimals, minorUnits: `${negative ? -raw : raw}` };
}

export function nativeWeiToUsdcCeil(value: string): UsdcMoney {
  if (!/^\d+$/.test(value)) throw new Error("Invalid native fee");
  const wei = BigInt(value);
  const divisor = POWERS[12];
  return { currency: "USDC", decimals: 6, minorUnits: ((wei + divisor - 1n) / divisor).toString() };
}

export function addUsdc(values: readonly Money[]): UsdcMoney {
  if (values.some((value) => value.currency !== "USDC" || value.decimals !== 6)) throw new Error("Expected 6-decimal USDC");
  return { currency: "USDC", decimals: 6, minorUnits: values.reduce((sum, value) => sum + BigInt(value.minorUnits), 0n).toString() };
}

export function minUsdc(...values: Money[]): UsdcMoney {
  if (!values.length) throw new Error("At least one value is required");
  if (values.some((value) => value.currency !== "USDC" || value.decimals !== 6)) throw new Error("Expected 6-decimal USDC");
  return { currency: "USDC", decimals: 6, minorUnits: values.reduce((minimum, value) => BigInt(value.minorUnits) < minimum ? BigInt(value.minorUnits) : minimum, BigInt(values[0].minorUnits)).toString() };
}
