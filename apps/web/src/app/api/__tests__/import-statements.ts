// Import guards for the parity tests: every static import / re-export plus
// every dynamic import, with the names a dynamic import binds. A namespace
// binding (`const data = await import('m')`) carries each `data.<name>` used.

const STATIC = /(?:import|export)[^;'"]*?from\s+['"][^'"]+['"]/g
const MODULE = String.raw`import\(\s*['"][^'"]+['"]\s*\)`
const DYNAMIC = new RegExp(
  [
    String.raw`(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:await\s+)?${MODULE}`,
    String.raw`(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:await\s+)?${MODULE}`,
    String.raw`\(\s*await\s+${MODULE}\s*\)(?:\s*\.\s*[A-Za-z_$][\w$]*)?`,
    String.raw`${MODULE}(?:\s*\.then\(\s*\(?\s*\{[^}]*\})?`,
  ].join('|'),
  'g',
)
const NAMESPACE = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/

export function importStatements(src: string): string[] {
  const statics = src.match(STATIC) ?? []
  const dynamics = (src.match(DYNAMIC) ?? []).map((stmt) => {
    const ns = NAMESPACE.exec(stmt)?.[1]
    if (!ns) return stmt
    const used = [...src.matchAll(new RegExp(String.raw`\b${ns.replace(/\$/g, '\\$')}\s*\.\s*([A-Za-z_$][\w$]*)`, 'g'))].map((m) => m[1])
    return used.length ? `${stmt} /* ${[...new Set(used)].join(', ')} */` : stmt
  })
  return [...statics, ...dynamics]
}
