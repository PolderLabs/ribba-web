// Minimale resolve-hook zodat Node's testrunner de tsconfig-alias '@/…' kan
// volgen (Next.js lost die zelf op; node kent 'm niet). Alleen testinfra —
// wordt geregistreerd via tests/_register-alias.mjs, nooit in runtime-code.
const ROOT = new URL('../', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    let rel = specifier.slice(2);
    if (!/\.[a-zA-Z]+$/.test(rel)) rel += '.ts';
    return nextResolve(new URL(rel, ROOT).href, context);
  }
  // Next's package-exports kennen 'next/server' niet in pure node-ESM-resolutie
  // (wel 'next/server.js'). Zelfde rewrite voor route-import én mock.module,
  // zodat beide op dezelfde resolved URL uitkomen.
  if (specifier === 'next/server') {
    return nextResolve('next/server.js', context);
  }
  return nextResolve(specifier, context);
}
