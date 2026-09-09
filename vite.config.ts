import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'development-refresh-csp',
    apply: 'serve',
    // Vite injects an inline React refresh preamble only in development.
    transformIndexHtml: { order: 'post', handler: html => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") }
  }],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/.cache/**', '**/.venv/**', '**/build/**', '**/release/**', '**/dist-electron/**', '**/test-results/**'] }
  }
});
