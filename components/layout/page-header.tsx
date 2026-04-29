import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-paper-line bg-paper-card/40 backdrop-blur sticky top-12 lg:top-0 z-20", className)}>
      <div className="px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap sm:flex-nowrap items-start sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs sm:text-sm text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
