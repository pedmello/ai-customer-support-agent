export const clearHandoffOffer = {
  handoffOfferId: null, handoffOfferReason: null, handoffOfferExpiresAt: null,
};

export function handoffDecision(content: string): 'accept' | 'decline' | null {
  const text = content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (/^(sim(?:,? solicitar atendimento)?|confirmar atendimento humano)[.!]?$/.test(text)) return 'accept';
  if (/^(nao(?:,? obrigado)?|recusar atendimento humano)[.!]?$/.test(text)) return 'decline';
  return null;
}

export function directHumanRequest(content: string) {
  const text = content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return text === 'atendente' || /^(?:(?:eu )?(?:quero|preciso(?: de)?|desejo) )?(?:falar com (?:um |uma |o |a )?(?:atendente|humano|pessoa)|(?:solicitar |solicito )?atendimento humano)(?:,? por favor)?[.!]?$/.test(text);
}

export function ambiguousHandoffReply(content: string) {
  return /^(talvez|nao sei|pode ser|como assim|sim|nao)[?!.]?$/i.test(
    content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
  );
}
