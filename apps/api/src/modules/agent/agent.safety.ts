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

type OrderReference = { kind: 'number'; orderNumber: number } | { kind: 'legacy' | 'context'; orderId: string } | { kind: 'invalid' };
// Only explicit order references or a bare number are accepted. A model cannot supply missing identity.
export function resolveOrderReference(content: string, proposedNumber: number | null, proposedId: string | null, lastOrderId: string | null): OrderReference {
  const legacyIds = [...new Set((content.match(uuidPattern) ?? []).map(id => id.toLowerCase()))];
  const withoutIds = content.replace(uuidPattern, '');
  const candidates = [...withoutIds.matchAll(/(?<![\d.,])\b([1-9]\d{4,9})\b(?!\d|[.,]\d)/g)];
  const usable = candidates.filter(match => {
    const start = match.index!;
    const before = withoutIds.slice(0, start);
    const after = withoutIds.slice(start + match[0].length);
    return !/(?:R\$|US\$|USD|BRL|pre[çc]o|valor|quantidade|qtd\.?|telefone|c[oó]digo)\s*$/i.test(before)
      && !/^\s*(?:unidades?|itens?|reais|d[oó]lares|pe[çc]as)\b/i.test(after);
  });
  const numbers = [...new Set(usable.map(match => Number(match[1])))];
  if (legacyIds.length) {
    if (legacyIds.length !== 1 || numbers.length || proposedNumber !== null) return { kind: 'invalid' };
    const id = resolveOrderId(content, proposedId, lastOrderId);
    return id ? { kind: 'legacy', orderId: id } : { kind: 'invalid' };
  }
  if (numbers.length) {
    if (numbers.length !== 1 || numbers[0]! > 2147483647 || proposedId || (proposedNumber !== null && proposedNumber !== numbers[0])) return { kind: 'invalid' };
    const number = numbers[0]!;
    const explicit = new RegExp(`(?:#|\\bpedido\\s*(?:n[ºo°.]?\\s*)?#?)\\s*${number}\\b`, 'i').test(content)
      || new RegExp(`^\\s*#?${number}\\s*[?.!]?\\s*$`).test(content)
      || new RegExp(`\\b(?:cancelar|consultar)\\s+${number}\\b`, 'i').test(content);
    return explicit ? { kind: 'number', orderNumber: number } : { kind: 'invalid' };
  }
  if (candidates.length || proposedNumber !== null) return { kind: 'invalid' };
  const context = resolveOrderId(content, proposedId, lastOrderId);
  return context ? { kind: 'context', orderId: context } : { kind: 'invalid' };
}

export function redactSensitive(text: string) {
  return text
    .replace(/(?:authorization|cookie|set-cookie|x-csrf-token)\s*:[^\r\n]*/gi, '[CREDENCIAL REMOVIDA]')
    .replace(/\bBearer\s+\S+/gi, '[CREDENCIAL REMOVIDA]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[CREDENCIAL REMOVIDA]')
    .replace(/\bAIza[A-Za-z0-9_-]{35}\b/g, '[CREDENCIAL REMOVIDA]')
    .replace(/(?:__Host-)?support_session\s*=\s*[^\s;]+/gi, '[CREDENCIAL REMOVIDA]')
    .replace(/\b[A-Za-z0-9_-]{43,}\b/g, '[SEGREDO REMOVIDO]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL REMOVIDO]')
    .replace(/\b(?:\+?\d[\d ().-]{9,}\d)\b/g, '[CONTATO REMOVIDO]');
}
