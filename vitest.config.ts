import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@covenant/core': pkg('core'),
      '@covenant/providers': pkg('providers'),
      '@covenant/agent': pkg('agent'),
      '@covenant/adapters': pkg('adapters'),
      '@covenant/sample-data': pkg('sample-data'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
