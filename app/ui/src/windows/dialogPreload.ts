// Holt den Code eines Dialog-Fensters schon beim Start der Seite, parallel zu Konfiguration und Plugins.
// Bewusst klein: nur dynamische Importe, damit `main.tsx` nichts Schweres mitzieht.
const PRELOAD: Record<string, () => Promise<unknown>> = {
  new: () => import('../shell/NewObjectDialog'),
  options: () => import('../shell/OptionsDialog'),
  deploy: () => import('../shell/DeployOptionsDialog'),
  rename: () => import('../tree/TreeDialogs'),
  plugins: () => import('../shell/PluginsDialog'),
  updates: () => import('../shell/UpdatesDialog'),
  localdata: () => import('../shell/LocalDataDialog'),
  zip: () => import('../shell/ProjectZipDialog'),
  about: () => import('../shell/Dialogs'),
  deployplan: () => import('../shell/DeployDialog'),
  themestudio: () => import('../studio/ThemeStudio'),
}

export function preloadDialog(name: string): void {
  void PRELOAD[name]?.().catch(() => {})
}
