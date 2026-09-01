import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// ÜYENİN "GEÇMİŞİM"İNDE NE VAR (owner, 2026-09-01).
//
// Liste bir OLUMSUZLUKLA tanımlanmıştı — *"yaklaşan rezervasyon olmayan her şey"* — ve öyle bir
// tanım ne dışarıda bırakacağını söylemez, sadece süpürür. İptaller de içeri girdi.
//
// Gerçek üyede iki ayrı yanlış olarak göründü, ve ikisinin de tek sebebi buydu:
//
//   · İptal ettiği 1 Eylül dersi "geçmiş rezervasyonlarım"da duruyordu.
//   · 3 Eylül'e ait İPTAL EDİLMİŞ bir kayıt, aynı güne yeniden aldığı dersin KOPYASI gibi
//     okunuyordu — üstte "Yaklaşan 3 Eyl", altta "Geçmiş 3 Eyl".
//
// Bu test o tanımın olumlu kalmasını tutar. Kural yeniden olumsuzlaştığı gün ("şunlar hariç hepsi")
// bir sonraki yeni durum sessizce üyenin ekranına düşer — bu sefer olan tam olarak buydu.

const FILE = join(process.cwd(), 'apps/web/src/server/portal-query.ts')

/** Kaynağın kodu, yorumlar çıkarılmış: yorumlar kastedilerek "iptal" kelimesini içeriyor. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('üyenin geçmiş rezervasyonları — başına GERÇEKTEN gelenler', () => {
  const code = codeOnly(readFileSync(FILE, 'utf8'))

  it('liste OLUMLU tanımlı: hangi durumların görüneceği tek tek yazılı', () => {
    expect(code).toContain('GECMISTE_GORUNENLER')
    expect(code).toMatch(/'attended'/)
    expect(code).toMatch(/'no_show'/)
  })

  it('iptal ve geç iptal listede DEĞİL', () => {
    // Bu iki dizgi kod tarafında hiç geçmemeli: geçiyorsa ya listeye eklenmiş ya da eski
    // "şunlar hariç" biçimine geri dönülmüş demektir.
    const liste = /GECMISTE_GORUNENLER[^\]]*\]/.exec(code)?.[0] ?? ''
    expect(liste).not.toContain('cancelled')
    expect(liste).not.toContain('late_cancelled')
  })

  it('geçmiş, SAATİ GEÇMİŞ derslerle sınırlı — gelecekteki bir kayıt oraya düşemez', () => {
    // 3 Eylül'ün kopya gibi görünmesinin ikinci yarısı buydu: tarih filtresi hiç yoktu.
    expect(code).toContain('r.sessionStartsAt <= nowMs')
  })

  it('yaklaşan listesi dokunulmadan duruyor', () => {
    expect(code).toContain("r.status === 'booked' && r.sessionStartsAt > nowMs")
  })

  it('PANELE dokunulmadı — bu dosya yalnızca üye tarafını besler', () => {
    // Owner: *"mobilde göstermesin, panelde doğru, ona dokunma."* Panel kendi sorgusunu kullanır
    // (`member-workspace-query.ts`) ve iptalleri açıkça "İptalleri göster" ile sunar.
    const panel = readFileSync(join(process.cwd(), 'apps/web/src/server/member-workspace-query.ts'), 'utf8')
    expect(panel).not.toContain('GECMISTE_GORUNENLER')
  })
})
