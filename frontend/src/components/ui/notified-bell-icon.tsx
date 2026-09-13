import { RiNotification3Line } from "react-icons/ri";
import { cn } from "@/lib/utils";

export function NotifiedBellIcon({ className }: { className?: string }) {
  return <RiNotification3Line aria-hidden="true" className={cn("icon-system h-4 w-4 shrink-0", className)} />;
}
