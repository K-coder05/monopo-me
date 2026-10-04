import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = process.env.PORT ?? '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true },
    },
  },
});
