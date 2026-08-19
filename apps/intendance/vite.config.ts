import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // L'app se juge sur un téléphone du réseau local, jamais sur localhost : sans
  // `host`, le serveur de dev n'écoute que la boucle locale et le téléphone ne
  // voit rien.
  server: { host: true, port: 5173 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
