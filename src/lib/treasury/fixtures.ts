import type { Money } from "./models";

export const usdc = (minorUnits: string): Money => ({ currency: "USDC", minorUnits, decimals: 6 });
