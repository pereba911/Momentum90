import { defineConfig } from "vitest/config";

// Goal Assistant 90 · config de pruebas (vitest).
// Entorno node (sin navegador): las pruebas de lógica pura importan src/lib/core
// y las pruebas de integridad/data-safety leen archivos estáticos del repo.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
