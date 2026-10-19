const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function explicitDecision(input: { content: string; confirmationId?: string }, pendingId: string | null) {
  if (!pendingId || input.confirmationId !== pendingId) return null;
  const text = input.content.trim().toUpperCase();
  if (text === 'CONFIRMAR CANCELAMENTO') return 'confirm';
  if (text === 'DESISTIR') return 'decline';
  return null;
}

// A model may resolve a pronoun, but cannot introduce an ID absent from trusted context/current text.
export function resolveOrderId(content: string, proposed: string | null, lastOrderId: string | null) {
  const ids = [...new Set((content.match(uuidPattern) ?? []).map((id) => id.toLowerCase()))];
  if (ids.length > 1) return null;
  if (ids.length === 1) return !proposed || proposed.toLowerCase() === ids[0] ? ids[0]! : null;
  return !proposed || proposed === lastOrderId ? lastOrderId : null;
}

export function redactSensitive(text: string) {
  return text
    .replace(/(?:authorization|cookie|set-cookie|x-csrf-token)\s*:[^\r\n]*/gi, '[CREDENCIAL REMOVIDA]')
    .replace(/\bBearer\s+\S+/gi, '[CREDENCIAL REMOVIDA]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[CREDENCIAL REMOVIDA]')
    .replace(/(?:__Host-)?support_session\s*=\s*[^\s;]+/gi, '[CREDENCIAL REMOVIDA]')
    .replace(/\b[A-Za-z0-9_-]{43,}\b/g, '[SEGREDO REMOVIDO]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL REMOVIDO]')
    .replace(/\b(?:\+?\d[\d ().-]{9,}\d)\b/g, '[CONTATO REMOVIDO]');
}
