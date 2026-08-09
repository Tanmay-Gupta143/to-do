declare module "lucide-react" {
  import type { ComponentType, SVGProps } from "react";

  type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;
  export const ArrowRight: Icon;
  export const CalendarDays: Icon;
  export const Check: Icon;
  export const Copy: Icon;
  export const LayoutDashboard: Icon;
  export const LogOut: Icon;
  export const MoreHorizontal: Icon;
  export const Pencil: Icon;
  export const Plus: Icon;
  export const Settings: Icon;
  export const ShieldCheck: Icon;
  export const Sparkles: Icon;
  export const Trash2: Icon;
}
