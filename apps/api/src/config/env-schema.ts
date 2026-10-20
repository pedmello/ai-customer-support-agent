import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().pipe(z.string().refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol))),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PUBLIC_URL: z.url().pipe(z.string().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))).default('http://localhost:3000'),
  WEB_ORIGIN: z.url().pipe(z.string().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  })).default('http://localhost:5173'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(604800).default(86400),
  EMAIL_PROVIDER: z.enum(['resend', 'disabled']).default('disabled'),
  EMAIL_FROM: z.string().trim().max(254).default(''),
  RESEND_API_KEY: z.string().trim().optional(),
  EMAIL_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(3000),
  PASSWORD_RESET_HMAC_SECRET: z.string().refine((value) => value === '' || value.length >= 32).optional(),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(600),
  PASSWORD_RESET_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(5),
  PASSWORD_RESET_RESEND_SECONDS: z.coerce.number().int().min(60).max(600).default(60),
  AI_PROVIDER: z.enum(['openai', 'gemini']).default('openai'),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().min(1).max(100).default('gemini-3.5-flash-lite'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(10000),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().trim().min(1).max(100).default('gpt-4.1-mini'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(10000),
  FAKE_STORE_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(5000),
  CONFIRMATION_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
}).superRefine((env, context) => {
  if (env.EMAIL_PROVIDER === 'resend') {
    for (const field of ['EMAIL_FROM', 'RESEND_API_KEY', 'PASSWORD_RESET_HMAC_SECRET'] as const) {
      if (!env[field]) context.addIssue({ code: 'custom', path: [field], message: 'Required for Resend' });
    }
    if (env.EMAIL_FROM && !z.email().safeParse(env.EMAIL_FROM).success) {
      context.addIssue({ code: 'custom', path: ['EMAIL_FROM'], message: 'Use a valid sender email' });
    }
  }
});

export function parseEnv(input: Record<string, unknown>) {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment variables: ${fields.join(', ')}`);
  }
  return result.data;
}
