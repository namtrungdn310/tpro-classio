import type { IconBaseProps } from "react-icons";
import { RiRefund2Line } from "react-icons/ri";

/** Canonical refund glyph used across fees, reports and confirmation actions. */
export function RefundIcon(props: IconBaseProps) {
  return <RiRefund2Line aria-hidden="true" className="icon-system" {...props} />;
}
