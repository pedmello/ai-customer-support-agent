import { useState } from "react";
import { Icon } from "./ui";
import { useEffect } from 'react';
import { useRef } from 'react';
import { PendingIndicator } from './PendingIndicator';
export function CopyOrderNumber({ orderNumber, iconOnly = false }: { orderNumber: number; iconOnly?: boolean }) {
  const [status, setStatus] = useState("");
  const [copying, setCopying] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  async function copy() {
    if (locked.current) return;
    locked.current = true;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(String(orderNumber));
      setStatus("Número copiado");
    } catch {
      setStatus("Não foi possível copiar. Selecione o número acima.");
    } finally {
      locked.current = false;
      setCopying(false);
    }
  }
  return (
    <span className={`copy-order ${iconOnly ? 'icon-only-copy' : ''}`}>
      <button
        onClick={() => void copy()}
        aria-label={`Copiar número do pedido ${orderNumber}`}
        title="Copiar número do pedido"
        disabled={copying}
      >
        <PendingIndicator active={copying} compact />
        <Icon name="copy" size={iconOnly ? 22 : 15} />
        {!iconOnly && 'Copiar'}
      </button>
      <small role="status">{status}</small>
    </span>
  );
}
