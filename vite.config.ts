import { defineConfig, loadEnv } from "vite";
import {
  isGuestModeAllowed,
  validateSupabaseConfiguration,
} from "./src/lib/supabase.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const values = {
    url: env.VITE_SUPABASE_URL,
    publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (!isGuestModeAllowed(values)) {
    const config = validateSupabaseConfiguration(
      values.url,
      values.publishableKey,
    );
    // VITE_ values are public. Reject administrator keys before any bundle is
    // generated; rejecting them only in the browser would already expose them.
    if (!config.configured) throw new Error(config.error);
  }
  return {
    // Relative assets work both at the domain root and under /-navi-/ on Pages.
    base: "./",
    server: { host: "0.0.0.0", port: 5173, strictPort: true },
  };
});
