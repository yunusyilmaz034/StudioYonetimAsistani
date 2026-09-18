import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// ÜYE GEÇMİŞ REZERVASYONLARINI GÖRMEZ (owner, 2026-09-15).
//
// *"Geçmiş rezervasyonların gün ve saati bize gözüksün, üyeye gözükmesin."* Owner kararı: üye tarafında
// geçmiş listesi hiç yok. 2026-09-01'de bu dosya "geçmişte hangi durumlar görünür" kuralını koruyordu;
// o kural artık yok, çünkü liste yok.
//
// Bu test üç şeyi tutar: sunucu geçmişi BOŞ döner (mağazadaki uygulama da bu cevabı okuyor), yaklaşan
// dersler dokunulmadan kalır, ve panelin tam kaydı bu karardan etkilenmez.

const FILE = join(process.cwd(), 'apps/web/src/server/portal-query.ts')

/** Kaynağın kodu, yorumlar çıkarılmış. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('üye tarafı rezervasyonlar — geçmiş yok', () => {
  const code = codeOnly(readFileSync(FILE, 'utf8'))

  it('geçmiş sunucuda BOŞ dönüyor', () => {
    expect(code).toContain('past: [],')
    expect(code).not.toContain('pastRaw')
  })

  it('yaklaşan listesi yalnızca GELECEK dersleri gösteriyor', () => {
    // Filtrenin şekli 18 Eylül'de değişti (aşağıdaki teste bak) ama korunan şey aynı: geçmiş ders
    // üyeye gösterilmez. Zaman koşulu her iki okuma yolunda da duruyor.
    expect(code.match(/r\.sessionStartsAt > nowMs/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  // GELMEYECEK İŞARETİ ÜYEDEN GİZLİ (owner, 2026-09-18): *"rezervasyonu düşmeyecek, her şey olağan
  // akışında gözükecek."* Resepsiyon koltuğu boşaltmak için "gelmedi" işaretler; üyenin ekranında
  // rezervasyonu yerinde kalır. Silinmiş görünse, kredisinin peşine düşmek için haklı bir zemini olurdu.
  it('gelmedi işaretlenen rezervasyon üyenin listesinden DÜŞMÜYOR', () => {
    expect(code.match(/r\.status === 'no_show'/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('web portalı geçmiş bölümünü çizmiyor', () => {
    const screen = readFileSync(join(process.cwd(), 'apps/web/src/app/portal/(member)/reservations/reservations-screen.tsx'), 'utf8')
    expect(screen).not.toContain('Geçmiş rezervasyon')
  })

  it('PANELE dokunulmadı — panelin tam kaydı kendi sorgusundan geliyor', () => {
    const panel = readFileSync(join(process.cwd(), 'apps/web/src/server/member-workspace-query.ts'), 'utf8')
    expect(panel.length).toBeGreaterThan(0)
    expect(panel).not.toContain('past: [],')
  })
})
