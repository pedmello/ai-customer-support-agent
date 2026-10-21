import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { AppError } from '../errors/app-error.js';

// The HTTP boundary generates this ID; user content never becomes log metadata.
export const requestCorrelation = new AsyncLocalStorage<string>();
type Event = 'agent.turn' | 'orders.query' | 'orders.cancel' | 'fake_store.lookup';
interface Outcome { result: string; replayed?: boolean; degraded?: boolean; }

export async function observeOperation<T>(logger: Logger | undefined, event: Event,
  operation: () => Promise<T>, summarize: (value: T) => Outcome): Promise<T> {
  const started = performance.now();
  const metadata = () => ({ event, durationMs: Math.round(performance.now() - started),
    ...(requestCorrelation.getStore() ? { requestId: requestCorrelation.getStore() } : {}) });
  try {
    const value = await operation();
    const { degraded, ...outcome } = summarize(value);
    logger?.[degraded ? 'warn' : 'info']({ ...metadata(), ...outcome }, 'Operation completed');
    return value;
  } catch (error) {
    logger?.warn({ ...metadata(), result: error instanceof AppError ? error.code : 'INTERNAL_ERROR' }, 'Operation failed');
    throw error;
  }
}
