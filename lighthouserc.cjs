/** @type {import('@lhci/utils/src/types').LHCIConfig} */
module.exports = {
  ci: {
    collect: {
      // Start the Vite preview server and audit the running app.
      startServerCommand: 'npm run preview -- --port 4173',
      startServerReadyPattern: 'Local',
      startServerReadyTimeout: 30000,
      url: ['http://localhost:4173/'],
      // Simulate a mid-tier mobile device on a 4G connection.
      settings: {
        // Lighthouse preset: simulated throttling (4G / Moto G Power)
        preset: 'desktop',
        throttlingMethod: 'simulate',
        throttling: {
          // 4G download/upload (approximate Fast 4G)
          downloadThroughputKbps: 9000,
          uploadThroughputKbps: 750,
          rttMs: 40,
          cpuSlowdownMultiplier: 4,
        },
        // Ensure service-worker / PWA checks run
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'pwa'],
      },
    },
    assert: {
      assertions: {
        // Core quality thresholds
        'categories:performance': ['warn', { minScore: 0.7 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.85 }],
        'categories:pwa': ['warn', { minScore: 0.8 }],

        // First Interactive / Time to Interactive < 3 000 ms (simulated 4G)
        'interactive': ['warn', { maxNumericValue: 3000 }],
      },
    },
    upload: {
      // Store reports as static files in the repo's .lighthouseci/ directory
      // rather than requiring an LHCI server.
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
};
