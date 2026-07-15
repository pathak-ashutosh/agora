import { cn } from '@/lib/utils';

/** Shimmering placeholder block. Size it with className. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

/** A stack of list-row placeholders for loading states inside panels. */
export function SkeletonRows({ n = 6, className }: { n?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5 p-3', className)} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="w-1.5 h-1.5 rounded-full shrink-0" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}
