import { useState } from "react";
import { Icon } from "./ui";
export function CopyOrderNumber({ orderNumber }: { orderNumber: number }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(String(orderNumber));
      setStatus("Número copiado");
    } catch {
      setStatus("Não foi possível copiar. Selecione o número acima.");
    }
  }
  return (
    <span className="copy-order">
      <button
        onClick={() => void copy()}
        aria-label={`Copiar número do pedido ${orderNumber}`}
      >
        <Icon name="copy" size={15} />
        Copiar
      </button>
      <small role="status">{status}</small>
    </span>
  );
}
