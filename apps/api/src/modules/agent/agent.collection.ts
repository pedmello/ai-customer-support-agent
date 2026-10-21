import type { OrderRecord } from '../orders/order.repository.js';
import { collectionPlanSchema } from '../../integrations/ai/collection-plan.js';
import type { AgentIntent } from '../../integrations/ai/intent-model.js';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export type CollectionQuery = { kind: 'list' | 'count' | 'exists' | 'total' | 'latest' | 'oldest' | 'highest' | 'products' | 'ambiguous'; status?: OrderRecord['status']; statuses?: OrderRecord['status'][]; excludedStatuses?: OrderRecord['status'][] };

// These questions inspect eligibility; they never authorize a mutation.
const eligibilityQuestion = (text: string) => /^(?:tenho (?:algum |alguns |meus )?pedidos? (?:elegiveis?|disponiveis?) para cancelamento|(?:quais|quantos) (?:dos meus |meus )?pedidos (?:posso cancelar|(?:sao |estao )?(?:elegiveis|disponiveis) para cancelamento))\s*[?.!]*$/.test(text.trim());

// Only current-message collection references qualify. A model reference or previous order cannot select a customer.
export function collectionQuery(content: string): CollectionQuery | null {
  const text = normalize(content);
  if (/\d|#|ignore|instruc|prompt|sistema|outro cliente|outra pessoa/.test(text)) return null;
  const excluded = /^(quantos|quais) (?:dos meus |meus )?pedidos (?:ainda )?nao (?:estao|foram) (enviados|cancelados|em processamento|processando)\s*[?.!]*$/.exec(text.trim());
  if (excluded) return { kind: excluded[1] === 'quantos' ? 'count' : 'list', excludedStatuses: [excluded[2] === 'enviados' ? 'SHIPPED' : excluded[2] === 'cancelados' ? 'CANCELLED' : 'PROCESSING'] };
  // Unknown polarity/constraints must be interpreted, never silently discarded.
  if (/\b(?:nao|nunca|nem|exceto|menos|sem)\b/.test(text)) return null;
  if (eligibilityQuestion(text)) return { kind: /\bquantos\b/.test(text) ? 'count' : 'list', status: 'PROCESSING' };
  if (/\b(?:cancele|cancel(?:e|ar|a|amento))\b/.test(text)) return null;
  const filters = ([
    ['PROCESSING', /processamento|processando/], ['SHIPPED', /enviad/], ['CANCELLED', /cancelad/],
  ] as const).filter(([, pattern]) => pattern.test(text)).map(([status]) => status);
  const plural = /\bpedidos\b/.test(text) || /\bprodutos\b.*\bcomprei\b/.test(text);
  const ranked = /\bpedido\b.*(?:mais recente|mais antigo|ultimo|primeiro|maior valor|mais caro)/.test(text)
    || /(?:ultimo|primeiro) pedido/.test(text);
  const implicitPlural = /^(?:(?:quantos|quais) (?:estao|foram)\b|tenho algum pedido\b)/.test(text.trim()) && filters.length > 0;
  if (!plural && !ranked && !implicitPlural) return null;
  if (!/\b(?:quais|quantos|quanto|qual|tenho|listar|liste|mostrar|mostre|comprei|gastei|custaram)\b/.test(text)) return null;
  if ([/mais recente|ultimo pedido/, /mais antigo|primeiro pedido/, /maior valor|mais caro/].filter(pattern => pattern.test(text)).length > 1) return { kind: 'ambiguous' };
  const status = filters[0];
  const kind = /mais recente|ultimo pedido/.test(text) ? 'latest' : /mais antigo|primeiro pedido/.test(text) ? 'oldest'
    : /maior valor|mais caro/.test(text) ? 'highest' : /valor|total|gastei|custaram/.test(text) ? 'total'
    : /quantos|quantidade/.test(text) ? 'count' : /produtos|comprei/.test(text) ? 'products' : 'list';
  return { kind, ...(filters.length > 1 ? { statuses: filters } : status ? { status } : {}) };
}

export function bulkCancellation(content: string) {
  const text = normalize(content);
  if (eligibilityQuestion(text)) return false;
  return /\b(cancel(?:ar|e|a|amento)|cancele)\b/.test(text) &&
    (/\b(todos|todas|tudo|ambos|varios|pedidos)\b/.test(text) || (text.match(/\b\d{5,10}\b/g)?.length ?? 0) > 1);
}

type PublicOrder = { orderNumber: number; status: OrderRecord['status']; currency: string; totalCents: number; createdAt: Date; items: Array<{ title: string; quantity: number }> };
const statuses = { PROCESSING: 'em processamento', SHIPPED: 'enviado', CANCELLED: 'cancelado' };
const amount = (cents: number, currency: string) => `${currency} ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100)}`;

export function collectionResponse(all: PublicOrder[], query: CollectionQuery) {
  const matching = all.filter(order => !query.excludedStatuses?.includes(order.status)
    && (query.statuses ? query.statuses.includes(order.status) : !query.status || order.status === query.status))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.orderNumber - a.orderNumber);
  const totals = [...matching.reduce((map, order) => map.set(order.currency, (map.get(order.currency) ?? 0) + order.totalCents), new Map<string, number>())]
    .sort(([a], [b]) => a.localeCompare(b)).map(([currency, totalCents]) => ({ currency, totalCents }));
  // A monetary ranking is only meaningful within the same currency. Ties use date/number.
  const highest = [...new Set(matching.map(order => order.currency))].sort().flatMap(currency =>
    matching.filter(order => order.currency === currency).sort((a, b) => b.totalCents - a.totalCents).slice(0, 1));
  const ranked = ['latest', 'oldest', 'highest'].includes(query.kind);
  const selected = query.kind === 'highest' ? highest : query.kind === 'oldest' ? matching.slice(-1)
    : query.kind === 'latest' ? matching.slice(0, 1) : matching.slice(0, 10);
  const label = query.excludedStatuses ? ` com status diferente de ${query.excludedStatuses.map(status => statuses[status]).join(' ou ')}` : query.status ? ` com status ${statuses[query.status]}` : query.statuses
    ? ` nos status consultados (${query.statuses.map(status => `${statuses[status]}: ${matching.filter(order => order.status === status).length}`).join('; ')})` : '';
  const count = `Você tem ${matching.length} pedido${matching.length === 1 ? '' : 's'}${label}.`;
  const rows = selected.map(order => `• Pedido #${order.orderNumber} — ${order.items.map(item => `${item.title} (quantidade ${item.quantity})`).join(', ')} — ${statuses[order.status]} — ${amount(order.totalCents, order.currency)} — criado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(order.createdAt)}.`);
  const reply = query.kind === 'ambiguous' ? 'Você mencionou mais de um critério de ordenação. Deseja o pedido mais recente, o mais antigo ou o de maior valor? Nenhum pedido foi alterado.'
    : query.kind === 'exists' ? `${matching.length ? 'Sim' : 'Não'}, ${count.charAt(0).toLowerCase()}${count.slice(1)}`
    : !matching.length ? count : query.kind === 'count' ? count
    : query.kind === 'total' ? `${count} Soma dos valores oficiais dos pedidos, incluindo cancelados quando não há filtro: ${totals.map(total => amount(total.totalCents, total.currency)).join('; ')}. Moedas diferentes são apresentadas separadamente; não representa valor pago ou reembolso.`
    : `${query.kind === 'latest' ? 'Seu pedido mais recente é:' : query.kind === 'oldest' ? 'Seu pedido mais antigo é:' : query.kind === 'highest' ? 'Pedido de maior valor por moeda (sem conversão entre moedas):' : count}\n${rows.join('\n')}${matching.length > selected.length && !ranked ? '\nMostrando os 10 mais recentes. A contagem considera todos os pedidos; consulte a lista Meus pedidos para os demais.' : ''}`;
  return { code: query.kind === 'ambiguous' ? 'NEEDS_CLARIFICATION' : 'ORDER_COLLECTION', reply, collection: { count: matching.length, totals, orders: (query.kind === 'ambiguous' ? [] : selected).map(order => ({ orderNumber: order.orderNumber, status: order.status, currency: order.currency, totalCents: order.totalCents, createdAt: order.createdAt, items: order.items })) } };
}

// Fail closed before any order read. Schema validation alone cannot detect semantic contradictions.
export function queryFromPlan(interpretation: AgentIntent, content: string): CollectionQuery | null {
  if (interpretation.intent !== 'ORDER_COLLECTION' || interpretation.orderId !== null || interpretation.orderNumber !== null) return null;
  const parsed = collectionPlanSchema.safeParse(interpretation.collectionPlan);
  if (!parsed.success) return null;
  const { operation, statusFilter, selection } = parsed.data;
  if ((operation === 'SELECT') !== (selection !== null)) return null;
  if (statusFilter && new Set(statusFilter.statuses).size !== statusFilter.statuses.length) return null;
  const text = normalize(content);
  if (bulkCancellation(content) || actionRefusal(content) || /\b(?:quero|desejo|preciso) (?:o )?cancelar\b/.test(text)) return null;
  // Literal status negation may not be changed to positive inclusion by the model.
  const negativeStatus = /\bnao (?:(?:estao|foram|foi|esta) (?:ainda )?)?(enviad\w*|cancelad\w*|em processamento)/.exec(text);
  if (negativeStatus) {
    const excluded = negativeStatus[1]!.startsWith('enviad') ? 'SHIPPED' : negativeStatus[1]!.startsWith('cancelad') ? 'CANCELLED' : 'PROCESSING';
    if (!statusFilter || (statusFilter.mode === 'EXCLUDE' ? !statusFilter.statuses.includes(excluded) : statusFilter.statuses.includes(excluded))) return null;
  }
  const kinds = { LIST: 'list', COUNT: 'count', EXISTS: 'exists', PRODUCTS: 'products', TOTAL: 'total' } as const;
  const kind = operation === 'SELECT' ? ({ LATEST: 'latest', OLDEST: 'oldest', HIGHEST: 'highest' } as const)[selection!] : kinds[operation];
  return { kind, ...(statusFilter ? statusFilter.mode === 'EXCLUDE' ? { excludedStatuses: statusFilter.statuses } : { statuses: statusFilter.statuses } : {}) };
}

// A negated desire is never an authorization, even if a model misclassifies it.
export function actionRefusal(content: string): 'cancel' | 'human' | null {
  const text = normalize(content);
  if (/\bnao (?:(?:quero|desejo|pretendo|vou)(?: mais)? (?:o |um )?cancel(?:ar|amento)|cancele|cancela)\b/.test(text)) return 'cancel';
  if (/\bnao (?:quero|desejo|preciso)(?: mais)? (?:de )?(?:(?:um |uma )?atendente|atendimento humano|falar com (?:um |uma )?atendente)\b/.test(text)) return 'human';
  return null;
}

// A singular question is not a request to list all orders or pick one arbitrarily.
export function individualOrderQuery(content: string) {
  const text = normalize(content);
  return !/\d|#|\bpedidos\b|cancel|ignore|instruc|prompt/.test(text)
    && /\b(?:status|detalhes|situacao)\b.*\bpedido\b/.test(text);
}

export function explicitOrderContext(content: string) {
  return /\b(?:esse|este|desse|deste|nesse|neste|aquele|daquele|dele|ele)\b/.test(normalize(content));
}
