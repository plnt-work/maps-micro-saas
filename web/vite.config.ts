import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /v1 → uvicorn on :8080 in dev so the WS and admin REST come from
// the same origin as the React app. Avoids CORS work for the demo.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
