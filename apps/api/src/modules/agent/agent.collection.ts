import type { OrderRecord } from '../orders/order.repository.js';
import { collectionPlanSchema } from '../../integrations/ai/collection-plan.js';
import type { AgentIntent } from '../../integrations/ai/intent-model.js';

const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export type CollectionQuery = { kind: 'list' | 'count' | 'exists' | 'total' | 'latest' | 'oldest' | 'highest' | 'products' | 'ambiguous'; status?: OrderRecord['status']; statuses?: OrderRecord['status'][]; excludedStatuses?: OrderRecord['status'][]; minimum?: number };
// "Mais de um pedido" asks about quantity, not about a value/date comparison.
const moreThanOneOrder = /\bmais de (?:um|uma) (?:pedidos?|compras?)\b/g;

// These questions inspect eligibility; they never authorize a mutation.
const eligibilityQuestion = (text: string) => /^(?:tenho (?:algum |alguns |meus )?pedidos? (?:elegiveis?|disponiveis?) para cancelamento|(?:quais|quantos) (?:dos meus |meus )?pedidos (?:posso cancelar|(?:sao |estao )?(?:elegiveis|disponiveis) para cancelamento))\s*[?.!]*$/.test(text.trim());

// The closed query plan cannot represent these facts/filters. A model must not erase them.
export function unsupportedOrderCriteria(content: string) {
  const text = normalize(content).replace(moreThanOneOrder, 'pedidos');
  if (!/\b(?:pedidos?|compras?|produtos?)\b/.test(text)) return false;
  return /\b(?:entregue?s?|entregados?|pag[oa]s?|pagamento|frete|rastreamento|reembolso|cupom|desconto|endereco|ontem|hoje|amanha|semanas?|mes|meses|anos?)\b/.test(text)
    || /\b(?:previsao|prazo) de entrega\b|\b(?:acima|abaixo|maior que|menor que|mais de|menos de|a partir de|desde|antes de|depois de)\b/.test(text)
    || /\b\d{1,4}[/-]\d{1,2}\b/.test(text);
}

// Only current-message collection references qualify. A model reference or previous order cannot select a customer.
export function collectionQuery(content: string): CollectionQuery | null {
  const text = normalize(content);
  if (unsupportedOrderCriteria(content)) return null;
  if (/\d|#|ignore|instruc|prompt|sistema|outro cliente|outra pessoa/.test(text)) return null;
  if (/^(?:eu )?(?:tenho|possuo|fiz) mais de (?:um|uma) (?:pedido|compra)s?\s*[?.!]*$/.test(text.trim())) return { kind: 'exists', minimum: 2 };
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
  // Only a small, known vocabulary is safe to answer without language interpretation.
  // Extra qualifiers are left to the model, rather than silently removed.
  const words = text.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const allowed = new Set('quais quantos quanto qual tenho algum alguns meus minhas meu minha os as o a um uma sao estao foram foi e ou de dos das do da em eu pedidos pedido produtos produto comprei listar liste mostrar mostre me por favor voce pode poderia consegue dizer saber status situacao total valor valores quantidade custaram gastei recente antigo ultimo primeiro mais maior caro enviado enviados cancelado cancelados processamento processando possuem'.split(' '));
  if (words.some(word => !allowed.has(word))) return null;
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
  // "Um dos meus pedidos" still selects a single order; the same number repeated is one order.
  const singular = text.replace(/\b(?:um|uma) d(?:os|as) (?:meus |minhas )?(?:pedidos|compras)\b/g, 'um pedido');
  return /\b(cancel(?:ar|e|a|amento)|cancele)\b/.test(singular) &&
    (/\b(todos|todas|tudo|ambos|varios|pedidos)\b/.test(singular) || new Set(singular.match(/\b\d{5,10}\b/g) ?? []).size > 1);
}

// Strict templates for frequent single-order requests, including the frontend's own messages.
// They only skip interpretation: ownership, status, confirmation and execution remain in the backend.
const orderReference = (article: string) => String.raw`${article}(?:meu |minha )?pedido (?:n(?:o|º|°|umero)\.? ?)?#? ?(\d{5,10})`;
const ofOrder = `d${orderReference('(?:o |a )')}`; // "do pedido", "do meu pedido"
const anOrder = orderReference('(?:o |a )?'); // "o pedido", "pedido"
const simpleTemplates: Array<[SimpleOrderRequest['intent'], RegExp]> = [
  ['ORDER_STATUS', new RegExp(`^(?:qual (?:e )?(?:o |a )?)?(?:status|situacao) ${ofOrder}$`)],
  ['ORDER_STATUS', new RegExp(`^(?:como (?:esta|ta|anda)|(?:quero |gostaria de |posso )?(?:consultar|ver|acompanhar)) ${anOrder}$`)],
  ['REQUEST_CANCEL', new RegExp(`^(?:(?:eu )?(?:quero|gostaria de|desejo|preciso|pode|poderia) )?cancel(?:ar|e|a) ${anOrder}$`)],
  ['ORDER_PRODUCTS', new RegExp(`^(?:quais (?:sao )?(?:os )?|(?:quero |gostaria de )?ver (?:os )?)(?:produtos|itens) ${ofOrder}$`)],
];
export type SimpleOrderRequest = { intent: 'ORDER_STATUS' | 'REQUEST_CANCEL' | 'ORDER_PRODUCTS'; orderNumber: number };
// A courtesy opening ("Olá, quero cancelar...") does not change the request that follows it.
const withoutGreeting = (text: string) => text.replace(/^(?:oi|ola|bom dia|boa tarde|boa noite|e ai|opa)(?:[\s,!.]+tudo (?:bem|bom))?[\s,!.?]+(?=\S)/, '');
const requestText = (content: string) => withoutGreeting(normalize(content).trim().replace(/\s+/g, ' '))
  .replace(/[\s.!?]+$/, '').replace(/,? por favor$/, '');
export function simpleOrderRequest(content: string): SimpleOrderRequest | null {
  const text = requestText(content);
  for (const [intent, pattern] of simpleTemplates) {
    const match = pattern.exec(text);
    if (match) return { intent, orderNumber: Number(match[1]) };
  }
  return null;
}

// A singular cancellation without a number asks which order; it never selects one.
export function cancellationWithoutOrder(content: string) {
  const text = requestText(content);
  const target = '(?:meu pedido|um pedido|um dos (?:meus )?pedidos|minha compra|uma compra|uma das (?:minhas )?compras)';
  return new RegExp(`^(?:(?:eu )?(?:quero|gostaria de|desejo|preciso|vou) |como (?:faco|posso) (?:para |pra )?)?cancelar (?:o )?${target}$`).test(text)
    || new RegExp(`^(?:(?:eu )?(?:quero|gostaria de|desejo|preciso) )?(?:solicitar |fazer )?(?:o |um )?cancelamento d(?:e |o )${target}$`).test(text);
}

// Greetings get a short guide instead of a clarification failure or a handoff offer.
export function greetingOnly(content: string) {
  const text = normalize(content).trim().replace(/[\s,!.?]+/g, ' ').trim();
  return /^(?:(?:oi|ola|bom dia|boa tarde|boa noite|e ai|opa)(?: tudo (?:bem|bom)| como vai(?: voce)?)?|tudo (?:bem|bom)|como vai(?: voce)?)$/.test(text);
}

// Out-of-scope messages that try to change rules or reach data get the security notice; harmless topics do not.
export function manipulationAttempt(content: string) {
  const text = normalize(content);
  return /\b(?:ignor\w*|instruc\w*|prompt|regras?|sistema|system|administrador|admin|desenvolvedor|developer|finj\w*|fing\w*|papel|jailbreak|revel\w*|credencia\w*|senhas?|tokens?|chaves?|terceiros|sql|banco de dados)\b/.test(text)
    || /\b(?:outros?|outras?|todos os|demais) (?:clientes?|pessoas?|usuarios?)\b/.test(text)
    || /\b(?:atualiz|alter|mud|troqu|troc)\w* (?:o |a |os |as )?(?:valor|valores|preco|precos|status|total)\b/.test(text);
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
    : query.kind === 'exists' ? `${matching.length >= (query.minimum ?? 1) ? 'Sim' : 'Não'}, ${count.charAt(0).toLowerCase()}${count.slice(1)}`
    : !matching.length ? count : query.kind === 'count' ? count
    : query.kind === 'total' ? `${count} Soma dos valores oficiais dos pedidos, incluindo cancelados quando não há filtro: ${totals.map(total => amount(total.totalCents, total.currency)).join('; ')}. Moedas diferentes são apresentadas separadamente; não representa valor pago ou reembolso.`
    : `${query.kind === 'latest' ? 'Seu pedido mais recente é:' : query.kind === 'oldest' ? 'Seu pedido mais antigo é:' : query.kind === 'highest' ? 'Pedido de maior valor por moeda (sem conversão entre moedas):' : count}\n${rows.join('\n')}${matching.length > selected.length && !ranked ? '\nMostrando os 10 mais recentes. A contagem considera todos os pedidos; consulte a lista Meus pedidos para os demais.' : ''}`;
  return { code: query.kind === 'ambiguous' ? 'NEEDS_CLARIFICATION' : 'ORDER_COLLECTION', reply, collection: { count: matching.length, totals, orders: (query.kind === 'ambiguous' ? [] : selected).map(order => ({ orderNumber: order.orderNumber, status: order.status, currency: order.currency, totalCents: order.totalCents, createdAt: order.createdAt, items: order.items })) } };
}

// Fail closed before any order read. Schema validation alone cannot detect semantic contradictions.
export function queryFromPlan(interpretation: AgentIntent, content: string): CollectionQuery | null {
  if (unsupportedOrderCriteria(content)) return null;
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
  const text = withoutGreeting(normalize(content).trim());
  return !/\d|#|\bpedidos\b|cancel|ignore|instruc|prompt/.test(text)
    && (/\b(?:status|detalhes|situacao)\b.*\bpedido\b/.test(text)
      || /^(?:e )?(?:cade|onde (?:esta|ta|anda|foi parar)) (?:o )?(?:meu )?(?:pedido|minha compra)\s*[?!.]*$/.test(text.trim()));
}

export function explicitOrderContext(content: string) {
  return /\b(?:esse|este|desse|deste|nesse|neste|aquele|daquele|dele|ele)\b/.test(normalize(content));
}
