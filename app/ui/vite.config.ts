import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Forge app/src-tauri's tauri.conf.json expects the built frontend at ../ui/dist
  // (architecture.md app/ui) and dev server on :5173 (matches the already-verified
  // spike-editor.md setup, ported as-is).
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Kein Vollbild-Fehlerfenster bei Syntaxfehlern im Dev-Modus: das Fenster bleibt bedienbar, der Fehler steht im Terminal von `tauri dev`.
    hmr: { overlay: false },
    // Windows meldet bei vielen Dateiänderungen auf einmal (Git-Wechsel, Skripte, Umbauten) nichts: der 16-KB-Puffer der
    // Datei-Ereignisse läuft über und Vite liefert danach alte Fassungen aus ("... is not defined"). Abfragen statt Ereignisse
    // hört nichts auf, kostet bei dieser Projektgröße kaum CPU (`node_modules` und `.git` sind ausgenommen).
    watch: { usePolling: true, interval: 250, binaryInterval: 1000, ignored: ['**/dist/**', '**/coverage/**'] },
  },
  build: {
    outDir: 'dist',
  },
  // Monaco workers load their parts with relative dynamic imports, which cannot be resolved when the worker is started from a blob:
  // URL (installed app). One self-contained file per worker avoids that.
  worker: {
    format: 'es',
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
