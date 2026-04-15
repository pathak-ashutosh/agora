import { cn } from '@/lib/utils';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
}

export function Toggle<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <div className="inline-flex rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-2.5 py-1 text-xs rounded transition-colors font-medium',
            value === opt.value
              ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
