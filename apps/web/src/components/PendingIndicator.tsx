import { useVisualPending } from '../hooks/useVisualPending';

export function PendingIndicator({ active, label = 'Processando…', compact = false }: { active: boolean; label?: string; compact?: boolean }) {
  const visible = useVisualPending(active);
  if (!visible) return null;
  return (
    <span className="pending-indicator" role={compact ? undefined : 'status'} aria-hidden={compact ? true : undefined}>
      <span className="pending-spinner" aria-hidden="true" />
      {!compact && <span>{label}</span>}
    </span>
  );
}
