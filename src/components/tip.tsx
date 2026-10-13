"use client";

import clsx from "clsx";
import { InfoTip } from "./visuals";

/*
 * InfoTip with a position that cannot push the page sideways. The shared tip centres a 288px note under
 * its button, which overflows the screen when the button sits near either edge. Here the note opens
 * towards the free side on wide screens (`align`) and spans the screen width below the `sm` breakpoint.
 * Class names are written out in full so Tailwind can see them.
 */
const side = {
  start: "sm:[&>[role=note]]:left-0 sm:[&>[role=note]]:translate-x-0",
  end: "sm:[&>[role=note]]:left-auto sm:[&>[role=note]]:right-0 sm:[&>[role=note]]:translate-x-0",
} as const;
const phone = "max-sm:[&>[role=note]]:fixed max-sm:[&>[role=note]]:inset-x-5 max-sm:[&>[role=note]]:top-auto max-sm:[&>[role=note]]:w-auto max-sm:[&>[role=note]]:translate-x-0";

export function Tip({ label, align = "start", children, className }: { label?: string; align?: keyof typeof side; children: React.ReactNode; className?: string }) {
  return <InfoTip label={label} className={clsx(side[align], phone, className)}>{children}</InfoTip>;
}
