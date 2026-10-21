import { z } from 'zod';
import type { Logger } from 'pino';
import { observeOperation } from '../../config/operation-log.js';

const productSchema = z.object({
  id: z.number().int().positive(), title: z.string().min(1).max(200),
  description: z.string().max(3000), category: z.string().max(120),
  image: z.url().pipe(z.string().refine((url) => new URL(url).protocol === 'https:')),
}).strip(); // Price and rating deliberately excluded.
export type ExternalProduct = z.infer<typeof productSchema>;
export type ProductResult = { productId: number; source: 'FAKE_STORE'; status: 'AVAILABLE'; product: ExternalProduct }
  | { productId: number; source: 'FAKE_STORE'; status: 'NOT_FOUND' | 'UNAVAILABLE'; code: string };
export interface ProductClient { getProduct(productId: number): Promise<ProductResult> }

export function createFakeStoreClient(options: { timeoutMs: number; logger: Logger; fetch?: typeof fetch }): ProductClient {
  const http = options.fetch ?? fetch;
  return {
    async getProduct(productId) {
      return observeOperation(options.logger, 'fake_store.lookup', async (): Promise<ProductResult> => {
        if (!Number.isSafeInteger(productId) || productId < 1) throw new Error('Invalid internal product identifier');
        try {
          const response = await http(`https://fakestoreapi.com/products/${productId}`, {
            signal: AbortSignal.timeout(options.timeoutMs), redirect: 'error', headers: { Accept: 'application/json' },
          });
          if (response.status === 404) return { productId, source: 'FAKE_STORE', status: 'NOT_FOUND', code: 'PRODUCT_NOT_FOUND' };
          if (!response.ok) throw new Error('EXTERNAL_UNAVAILABLE');
          // Bound streaming bodies too, not just Content-Length from an untrusted server.
          const reader = response.body?.getReader();
          if (!reader) throw new Error('EXTERNAL_INVALID_RESPONSE');
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 32768) { await reader.cancel(); throw new Error('EXTERNAL_INVALID_RESPONSE'); }
            chunks.push(value);
          }
          const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (data === null) return { productId, source: 'FAKE_STORE', status: 'NOT_FOUND', code: 'PRODUCT_NOT_FOUND' };
          const product = productSchema.parse(data);
          if (product.id !== productId) throw new Error('EXTERNAL_INVALID_RESPONSE');
          return { productId, source: 'FAKE_STORE', status: 'AVAILABLE', product };
        } catch (error) {
          const code = error instanceof Error && error.name === 'TimeoutError' ? 'PRODUCT_TIMEOUT'
            : error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === 'EXTERNAL_INVALID_RESPONSE')
              ? 'PRODUCT_INVALID_RESPONSE' : 'PRODUCT_UNAVAILABLE';
          return { productId, source: 'FAKE_STORE', status: 'UNAVAILABLE', code };
        }
      }, value => ({ result: value.status === 'AVAILABLE' ? 'AVAILABLE' : value.code, degraded: value.status !== 'AVAILABLE' }));
    },
  };
}
