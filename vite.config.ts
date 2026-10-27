import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Alias dipakai bersama oleh Vite (src/) dan Vitest. Lambda di amplify/functions/*
// dibundel oleh esbuild Amplify dan memakai tsconfig paths yang sama.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fromRoot('./shared'),
      shared: fromRoot('./shared'),
      '@': fromRoot('./src'),
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'amplify/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
