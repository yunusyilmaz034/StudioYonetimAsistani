// `'use client'` dosyaları `@studio/core` BARREL'ından DEĞER import etmez (7 Ekim 2026).
//
// Neden ayrı bir betik: `pnpm check` bunu yakalayamıyordu. `tsc --noEmit` tip olarak mutlu,
// ESLint selector'ları dosya düzeyinde "bu dosyada 'use client' var mı" koşulu kuramıyor, ve
// `next build`'i kapıya koymak kapıyı saniyelerden dakikalara çıkarır — Doc 10 bunu yasaklıyor:
// "A gate that takes two minutes is a gate that gets skipped."
//
// Neden bir kural: 7 Ekim'de `week-plan-panel.tsx`e barrel'dan bir DEĞER import ettim
// (`minimumBreakMinutes`). Tip import'ları derlemede silinir, değer import'u gerçek modül grafiği
// kurar — ve barrel `members/infrastructure/purge.ts` üzerinden `firebase-admin`i çekiyor. Canlı
// build "Can't resolve 'fs' / 'net'" diye düştü, rollout FAILED oldu, otomatik deploy durdu.
//
// Doğru kapı `@studio/core/client` (AD-71): kasten self-contained, saf, bağımlılıksız.
import { globSync, readFileSync } from 'node:fs'

const dosyalar = globSync('apps/web/src/**/*.{ts,tsx}')
const ihlaller = []
for (const yol of dosyalar) {
  const metin = readFileSync(yol, 'utf8')
  if (!/^\s*['"]use client['"]/m.test(metin)) continue
  metin.split('\n').forEach((satir, i) => {
    // `import type { … }` ve `import { type X }` silinir, sorun değil. Yakalanan: en az bir DEĞER.
    const m = /^import\s+\{([^}]*)\}\s+from\s+['"]@studio\/core['"]/.exec(satir)
    if (!m) return
    const degerVar = m[1].split(',').some((p) => p.trim() !== '' && !p.trim().startsWith('type '))
    if (degerVar) ihlaller.push(`${yol}:${i + 1}  ${satir.trim()}`)
  })
}
if (ihlaller.length > 0) {
  console.error("\nclient-boundary: 'use client' dosyası @studio/core BARREL'ından DEĞER import ediyor.")
  console.error("Bu, firebase-admin'i tarayıcı paketine sokar ve `next build` çöker.")
  console.error("Çözüm: @studio/core/client kullan (AD-71), ya da yalnızca `import type`.\n")
  for (const i of ihlaller) console.error('  ' + i)
  console.error('')
  process.exit(1)
}
console.log(`client-boundary: temiz (${dosyalar.length} dosya tarandı)`)
