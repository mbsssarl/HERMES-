import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "cn";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  color?: "primary" | "success" | "warning" | "destructive" | "info";
}

const COLOR_CLASSES: Record<NonNullable<StatCardProps["color"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

export function StatCard({ label, value, icon: Icon, color = "primary" }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        {Icon && (
          <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", COLOR_CLASSES[color])}>
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm leading-tight">{label}</p>
          <p className="mt-0.5 text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
