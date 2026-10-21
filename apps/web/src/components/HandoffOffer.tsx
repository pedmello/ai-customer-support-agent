import { useEffect, useState } from 'react';
import type { SupportState } from '../hooks/useSupport';
import { PendingIndicator } from './PendingIndicator';

export function HandoffOffer({ support }: { support: SupportState }) {
  const offer = support.history?.pendingHandoff;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!offer) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [offer?.offerId]);
  if (!offer) return null;
  const expired = new Date(offer.expiresAt).getTime() <= now;
  const disabled = !!support.busy || !!support.messageBusy || !!support.retry;
  return (
    <section className="confirmation card" aria-label="Oferta de atendimento humano">
      <strong>{expired ? 'Esta oferta expirou' : 'Você gostaria de solicitar atendimento humano?'}</strong>
      <p>{expired ? 'Se desejar, solicite atendimento humano novamente.' : 'O encaminhamento é simulado. Não há equipe real conectada nem contato agendado.'}</p>
      {!expired && <div>
        <button className="primary" disabled={disabled} onClick={() => void support.decideHandoff(true)}><PendingIndicator compact active={!!support.sending?.handoffOfferId && support.sending.content === 'Sim, solicitar atendimento'} />Sim, solicitar atendimento</button>
        <button disabled={disabled} onClick={() => void support.decideHandoff(false)}><PendingIndicator compact active={!!support.sending?.handoffOfferId && support.sending.content === 'Não, obrigado'} />Não, obrigado</button>
      </div>}
    </section>
  );
}
