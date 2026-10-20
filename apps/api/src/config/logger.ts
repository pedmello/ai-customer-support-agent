import { pino, type LoggerOptions } from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    base: { service: 'support-api' },
    redact: {
      paths: ['password', 'passwordConfirmation', 'passwordHash', 'code', 'verifier', 'token', 'tokenHash', 'authorization',
        '*.password', '*.passwordConfirmation', '*.passwordHash', '*.code', '*.verifier', '*.token', '*.tokenHash',
        'req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]',
        'DATABASE_URL', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'RESEND_API_KEY', 'PASSWORD_RESET_HMAC_SECRET'],
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
