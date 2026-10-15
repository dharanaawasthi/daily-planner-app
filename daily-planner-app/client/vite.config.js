import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.API_PORT || 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the React app calls /api/... and Vite forwards it to Express.
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  },
});
