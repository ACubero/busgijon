import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/api": {
        target: "https://emtusasiri.pub.gijon.es",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/emtusasiri"),
        secure: false,
      },
    },
  },
});
