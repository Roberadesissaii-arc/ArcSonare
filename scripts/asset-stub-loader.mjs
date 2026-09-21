/**
 * Let Node load application modules that import bundler-only assets.
 *
 * Vite resolves `.svg`, `.png` and `.css` imports at build time; Node has no
 * idea what to do with them and throws ERR_UNKNOWN_FILE_EXTENSION. Test scripts
 * that import real application code therefore cannot run without this.
 *
 * Each asset becomes an empty-string default export, which is what the code
 * treats them as anyway (an icon URL). Nothing under test depends on the value.
 */
const ASSET = /\.(svg|png|jpe?g|gif|webp|css|scss)$/i;

/**
 * Modules built entirely out of `import.meta.glob`, which is Vite syntax Node
 * cannot evaluate at all — importing one throws before any test runs. They are
 * icon-URL lookups, so a stub that finds no icon is the honest empty case.
 *
 * Kept to an explicit list: silently stubbing anything that fails to load would
 * let a real broken module pass as "no icons".
 */
const GLOB_ONLY = new Map([
  [
    /config[\\/]appIconLibrary(\.ts)?$/,
    "export const appIconUrl = () => null; export const appIconCount = () => 0;",
  ],
  [
    /config[\\/]topOverlayIconRegistry(\.ts)?$/,
    "export const TOP_OVERLAY_ICONS = []; export const SYSTEM_OVERLAY_ICONS = {};" +
      " export const getIconById = () => undefined; export const getAllIconUrls = () => ({});",
  ],
]);

export async function resolve(specifier, context, next) {
  if (ASSET.test(specifier)) {
    return {
      url: "data:text/javascript,export default ''",
      shortCircuit: true,
    };
  }
  for (const [pattern, source] of GLOB_ONLY) {
    if (pattern.test(specifier)) {
      return {
        url: `data:text/javascript,${encodeURIComponent(source)}`,
        shortCircuit: true,
      };
    }
  }
  return next(specifier, context);
}
