import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center px-4 py-12 text-center">
      {icon && <div className="mb-3 text-4xl opacity-50 [&_svg]:size-10">{icon}</div>}
      <p className="text-foreground text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
