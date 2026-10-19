import { describe, expect, it } from 'vitest';
import { openapi } from '../src/docs/openapi.js';
import { readFileSync } from 'node:fs';
import { AGENT_SYSTEM_PROMPT } from '../src/integrations/openai/agent.prompt.js';
describe('agent OpenAPI contract', () => {
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
    const doc = readFileSync(new URL('../../../docs/stage-3.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    expect(doc).toContain(AGENT_SYSTEM_PROMPT);
  });
});
