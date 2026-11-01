import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Alias dipakai bersama oleh Vite (src/) dan Vitest. Lambda di amplify/functions/*
// dibundel oleh esbuild Amplify dan memakai tsconfig paths yang sama.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Arto - Pelacak Pengeluaran',
        short_name: 'Arto',
        description: 'Pelacak pengeluaran pribadi berbahasa Indonesia',
        theme_color: '#005DAC',
        background_color: '#F1EEDB',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache seluruh aset aplikasi
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Fallback ke index.html untuk navigasi offline (SPA)
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/graphql/],
      },
    }),
  ],
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
