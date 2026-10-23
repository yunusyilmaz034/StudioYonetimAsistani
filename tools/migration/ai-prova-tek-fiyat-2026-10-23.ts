import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { execSync } from 'node:child_process'

import { __rehearsal } from '../../apps/functions/src/http/whatsapp-webhook'

// AI PROVASI — TEK FİYAT (owner, 2026-10-23). SALT OKUNUR: canlı AI ayarları + canlı fiyat bilgisiyle AI'ya
// müşteri gibi soru sorar, cevabı ekrana basar; WhatsApp'a hiçbir şey gitmez, hiçbir şey yazılmaz.
//   pnpm tsx tools/migration/ai-prova-tek-fiyat-2026-10-23.ts

const SORULAR = [
  'Merhaba fitness fiyatları nedir?',
  'Kredi kartıyla ödesem fiyat değişir mi? Nakit daha ucuz mu?',
  'Reformer pilates ne kadar? Taksit var mı?',
  'Hamile pilatesi var mı, ücreti nedir?',
  'Hibrit paket fiyatı ne?',
  'Siz bana 3 aylık 8.500 dediniz ama uygulamada 9.500 yazıyor, neden farklı?',
  'Kartla ödeyince neden daha pahalı oluyor? Bu yasal mı, şikayet edeceğim',
  'Tamam beni arayın o zaman',
]

async function main(): Promise<void> {
  initializeApp({ projectId: 'studio-yonetim-prod' })
  const db = getFirestore()
  const ai = (await db.doc('studios/retro/settings/ai').get()).data() as never as { priceList?: string }
  const ctx = { studioId: 'retro', branchIds: [], role: 'owner', actor: { type: 'system', id: 'ai_prova' } } as never
  const key = process.env.ANTHROPIC_API_KEY ?? execSync('gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY --project studio-yonetim-prod').toString().trim()
  const facts = await __rehearsal.liveFacts(db as never, ctx, ai.priceList)
  const system = __rehearsal.buildSystem(ai as never)
  for (const q of SORULAR) {
    const r = await __rehearsal.aiReply(key, system, facts, null, [{ role: 'user', text: q, at: Date.now() } as never])
    console.log(`\n▶ ${q}\n${r?.reply ?? '(cevap yok)'}${r?.escalate ? '  [DEVRET]' : ''}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
