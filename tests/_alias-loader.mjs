// Minimale resolve-hook zodat Node's testrunner de tsconfig-alias '@/…' kan
// volgen (Next.js lost die zelf op; node kent 'm niet). Alleen testinfra —
// wordt geregistreerd via tests/_register-alias.mjs, nooit in runtime-code.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  // Bronbestanden importeren elkaar zonder extensie ('./legal-versions').
  // TypeScript en Next lossen dat op; pure node-ESM niet. Alleen proberen als
  // het buurbestand echt een .ts is — anders gewoon doorgeven.
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier) && context.parentURL) {
    const kandidaat = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(kandidaat))) {
      return nextResolve(kandidaat.href, context);
    }
  }
  return nextResolve(specifier, context);
}
