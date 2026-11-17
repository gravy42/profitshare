// The deck's runtime as text, made by the plugin in vite.config.ts from the sources in this folder.
declare module 'virtual:deck-runtime' {
  /** One minified script that defines `window.ProfitShareDeck = { mountDeck }`. */
  export const runtimeJs: string;
  /** deck.css, as written. */
  export const runtimeCss: string;
}
