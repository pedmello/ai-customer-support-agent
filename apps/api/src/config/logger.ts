import { pino, type LoggerOptions } from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    base: { service: 'support-api' },
    redact: {
      paths: ['password', 'token', 'authorization', 'DATABASE_URL', 'OPENAI_API_KEY'],
      censor: '[REDACTED]',
    },
    // Mensagens de drivers podem conter connection strings ou dados pessoais.
    serializers: {
      err: (error: unknown) => ({
        type: error instanceof Error ? error.name : 'UnknownError',
      }),
    },
  } satisfies LoggerOptions);
}
