import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 5174 keeps this off the default 5173, so another Vite project can run at
    // the same time. It's also the origin the API's CORS allowlist names.
    port: 5174,
    strictPort: true,
    // The client always calls a relative /api path (see src/api/client.ts), so
    // dev and production share one code path — this proxy is what makes the
    // relative path work before there's a reverse proxy in front of both.
    proxy: {
      "/api": {
        target: "http://localhost:3040",
        changeOrigin: true,
      },
    },
  },
});
