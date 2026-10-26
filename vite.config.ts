import { defineConfig } from "vite";

export default defineConfig({
  // Relative assets work both at the domain root and under /-navi-/ on Pages.
  base: "./",
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
