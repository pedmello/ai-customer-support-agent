import { useEffect, useRef, useState } from 'react';

// Only presentation outlives a very fast request. Data, errors and action locks never wait for this timer.
export function useVisualPending(active: boolean, minimumMs = 180) {
  const [visible, setVisible] = useState(active);
  const started = useRef<number | null>(active ? Date.now() : null);
  useEffect(() => {
    if (active) {
      started.current = Date.now();
      setVisible(true);
      return;
    }
    if (started.current === null) return;
    const remaining = Math.max(0, minimumMs - (Date.now() - started.current));
    const finish = () => { started.current = null; setVisible(false); };
    if (!remaining) { finish(); return; }
    const timer = setTimeout(finish, remaining);
    return () => clearTimeout(timer);
  }, [active, minimumMs]);
  return active || visible;
}
