import { describe, expect, it } from 'vitest';
import { openapi } from '../src/docs/openapi.js';
import { readFileSync } from 'node:fs';
import { AGENT_SYSTEM_PROMPT } from '../src/integrations/openai/agent.prompt.js';
import { sendMessageSchema } from '../src/modules/conversations/conversation.schemas.js';
import { responseExamples } from '../src/docs/response-examples.js';
describe('agent OpenAPI contract', () => {
  it('documents registration throttling and the mutually exclusive decision identifiers', () => {
    expect(openapi.paths['/customers'].post.responses).toHaveProperty('429');
    expect(openapi.components.schemas.SendAgentMessage.not).toEqual({ required: ['confirmationId', 'handoffOfferId'] });
    expect(sendMessageSchema.safeParse({ clientMessageId: '41d0bbe7-cf9e-4f53-99f1-1febbf22802f', content: 'Sim',
      confirmationId: '41d0bbe7-cf9e-4f53-99f1-1febbf22802f', handoffOfferId: '41d0bbe7-cf9e-4f53-99f1-1febbf22802f' }).success).toBe(false);
  });
  it('documents mandatory history, collection fields and complete response examples', () => {
    const history = openapi.components.schemas.ConversationHistory.properties.data.properties.turns.items;
    expect(history.required).toEqual(['turnId', 'clientMessageId', 'createdAt', 'messages']);
    expect(history.properties.messages.items.required).toContain('role');
    expect(openapi.components.schemas.AgentMessageResponse.properties.data.properties.collection.required).toEqual(['count', 'totals', 'orders']);
    for (const name of ['CurrentSession', 'OrderResponse', 'OrderPage', 'ConversationHistory', 'AgentMessageResponse', 'HandoffResponse', 'RecoveryAccepted']) {
      expect(responseExamples[name], name).toBeDefined();
    }
    expect(openapi.paths['/conversations/{conversationId}/messages'].post.responses['200'].content['application/json'].example).toEqual(responseExamples.AgentMessageResponse);
  });
  it('shows a cancelled order in the successful cancellation example', () => {
    const example = openapi.paths['/orders/{orderId}/cancel'].post.responses['200'].content['application/json'].example as { data: Record<string, unknown> };
    expect(example.data.status).toBe('CANCELLED');
    expect(example.data.cancelledAt).toEqual(expect.any(String));
    expect(example.data.updatedAt).toBe(example.data.cancelledAt);
    const schema = openapi.components.schemas.Order;
    expect(Object.keys(example.data).sort()).toEqual([...schema.required].sort());
    expect((responseExamples.OrderResponse as { data: { status: string } }).data.status).toBe('PROCESSING');
  });
  it('resolves all local component references', () => {
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') {
          const path = value.slice(2).split('/');
          let target: unknown = openapi;
          for (const segment of path) target = (target as Record<string, unknown>)?.[segment];
          expect(target, value).toBeDefined();
        } else visit(value);
      }
    };
    visit(openapi);
  });
  it('documents cookie and CSRF together on all agent writes', () => {
    for (const path of ['/conversations', '/conversations/{conversationId}/messages', '/handoffs'] as const) {
      expect(openapi.paths[path].post.security).toContainEqual({ cookieSession: [], csrfToken: [] });
    }
  });
  it('documents the exact system prompt used at runtime', () => {
    for (const file of ['stage-3.md', 'agent-instructions.md']) {
      const doc = readFileSync(new URL(`../../../docs/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
      expect(doc, file).toContain(AGENT_SYSTEM_PROMPT);
    }
  });
});
