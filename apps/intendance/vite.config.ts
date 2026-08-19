import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // L'app se juge sur un téléphone du réseau local, jamais sur localhost : sans
  // `host`, le serveur de dev n'écoute que la boucle locale et le téléphone ne
  // voit rien.
  server: { host: true, port: 5173 },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // IndexedDB n'existe pas dans Node. `fake-indexeddb` en pose une vraie
    // implémentation en mémoire : les tests de la base exercent Dexie pour de
    // bon — transactions, index, contraintes — et pas un bouchon qui dirait oui.
    setupFiles: ["src/db/setup-tests.ts"],
  },
});
