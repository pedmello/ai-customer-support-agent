import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { parseEnv } from './env-schema.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

export const env = parseEnv(process.env);
