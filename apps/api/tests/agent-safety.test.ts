import { describe, expect, it } from 'vitest';
import { explicitDecision, redactSensitive, resolveOrderId } from '../src/modules/agent/agent.safety.js';

describe('deterministic agent boundaries', () => {
  it('requires an exact confirmation phrase and the current challenge identifier', () => {
    const id = 'e62fc3de-6b19-44fd-8cfb-1ffb2b2e71ce';
    expect(explicitDecision({ content: 'CONFIRMAR CANCELAMENTO', confirmationId: id }, id)).toBe('confirm');
    expect(explicitDecision({ content: 'sim', confirmationId: id }, id)).toBeNull();
    expect(explicitDecision({ content: 'CONFIRMAR CANCELAMENTO' }, id)).toBeNull();
    expect(explicitDecision({ content: 'CONFIRMAR CANCELAMENTO', confirmationId: 'other' }, id)).toBeNull();
    expect(explicitDecision({ content: 'DESISTIR', confirmationId: id }, id)).toBe('decline');
  });
  it('does not accept invented order IDs from a model or an ambiguous message', () => {
    const id = 'e62fc3de-6b19-44fd-8cfb-1ffb2b2e71ce';
    const other = '5227ac59-fb49-44d7-9c59-9d7703f15379';
    expect(resolveOrderId(`pedido ${id}`, id, null)).toBe(id);
    expect(resolveOrderId(`pedido ${id}`, other, null)).toBeNull();
    expect(resolveOrderId('esse pedido', null, id)).toBe(id);
    expect(resolveOrderId(`${id} e ${other}`, id, null)).toBeNull();
  });
  it('redacts recognizable credentials and personal contacts before persistence or inference', () => {
    const result = redactSensitive('email ana@example.com Authorization: Bearer abc.secret Cookie: support_session=secret sk-proj-12345678901234567890');
    expect(result).not.toContain('ana@example.com');
    expect(result).not.toContain('abc.secret');
    expect(result).not.toContain('support_session=secret');
    expect(result).not.toContain('sk-proj-');
  });
});
