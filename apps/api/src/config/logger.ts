import { pino, type DestinationStream, type LoggerOptions } from 'pino';

// The optional destination lets tests inspect the production redaction configuration.
export function createLogger(level = 'info', destination?: DestinationStream) {
  const options = {
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
  } satisfies LoggerOptions;
  return destination ? pino(options, destination) : pino(options);
}
