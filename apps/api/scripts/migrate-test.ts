import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { testDatabaseUrl } from '../tests/helpers/test-database.js';

const databaseUrl = testDatabaseUrl();
const require = createRequire(import.meta.url);
const prismaPackage = require.resolve('prisma/package.json');
const metadata: { bin: { prisma: string } } = JSON.parse(readFileSync(prismaPackage, 'utf8'));
const result = spawnSync(process.execPath, [resolve(dirname(prismaPackage), metadata.bin.prisma), 'migrate', 'deploy'], {
  cwd: resolve(import.meta.dirname, '..'),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});
if (result.error) throw new Error('Could not start Prisma migration process');
process.exitCode = result.status ?? 1;
