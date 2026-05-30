import temmlUrl from 'temml/dist/temml.mjs?url';

export type TemmlEngine = {
  renderToString(tex: string, options?: Record<string, unknown>): string;
};

let cache: Promise<TemmlEngine> | null = null;

/**
 * Load Temml as an *untransformed* ESM asset.
 *
 * Temml registers its ~80 TeX commands by mutating a module-level `const _functions = {}` at import
 * time. When Vite/rolldown re-bundles the library it mishandles that mutated const, leaving the command
 * table empty at runtime — every command becomes "Unsupported function name", and which ones survive
 * is unstable across builds. Importing the prebuilt `temml.mjs` via `?url` makes Vite emit the file
 * verbatim and the browser load it natively, so the registrations run exactly as they do under Node.
 *
 * Cached: the (large) module is fetched and evaluated once.
 */
export function loadTemml(): Promise<TemmlEngine> {
  if (!cache) {
    cache = import(/* @vite-ignore */ temmlUrl).then((m) => (m.default ?? m) as TemmlEngine);
  }
  return cache;
}
