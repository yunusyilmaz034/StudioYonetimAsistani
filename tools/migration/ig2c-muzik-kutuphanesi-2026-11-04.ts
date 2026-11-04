import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// IG-2c — İLK MÜZİK KÜTÜPHANESİ (owner onayı, 2026-11-04): Pixabay'den 10 telifsiz parça (Pixabay Content
// License: ticari kullanım serbest, kaynak gösterme gerekmez; yalnız tek başına satış/dağıtım yasak).
// Dosyalar önceden `studios/retro/music/pixabay-N.mp3` olarak yüklendi. Var olan parçalara dokunmaz (id ile ekler).
//   pnpm tsx tools/migration/ig2c-muzik-kutuphanesi-2026-11-04.ts            (kuru çalışma)
//   pnpm tsx tools/migration/ig2c-muzik-kutuphanesi-2026-11-04.ts --apply
const STUDIO = 'retro'
const TRACKS: readonly [name: string, artist: string, mood: 'sakin' | 'hareketli', seconds: number][] = [
  ['Morning Pilates Practice', 'bearstockmusic', 'sakin', 126],
  ['Pilates Flow', 'ElectroAnimals', 'sakin', 127],
  ['Yoga Sunrise Flow Stretch', 'alex-morgan', 'sakin', 174],
  ['Slow Focus and Meditation Piano', 'Music_For_Videos', 'sakin', 114],
  ['Ambient Yoga Music', 'YuraSoop', 'sakin', 166],
  ['Fitness Workout', 'AtlasAudio', 'hareketli', 154],
  ['Workout Song', 'AtlasAudio', 'hareketli', 120],
  ['Workout', 'Sub_Clair', 'hareketli', 151],
  ['Sport Workout', 'The_Mountain', 'hareketli', 126],
  ['In Rhythm With Life', 'MagalyStudio', 'hareketli', 288],
]

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const ref = getFirestore().doc(`studios/${STUDIO}/settings/content`)
  const current = ((await ref.get()).get('music') as { id: string }[] | undefined) ?? []
  const add = TRACKS.map(([name, artist, mood, seconds], i) => ({
    id: `trk_pixabay${i + 1}`,
    name,
    mood,
    seconds,
    storagePath: `studios/${STUDIO}/music/pixabay-${i + 1}.mp3`,
    source: `Pixabay · ${artist}`,
    active: true,
  })).filter((t) => !current.some((c) => c.id === t.id))
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`mevcut ${current.length} parça; eklenecek ${add.length}:`)
  for (const t of add) console.log(`  ${t.id} · ${t.name} · ${t.mood} · ${t.seconds} sn`)
  if (apply && add.length) {
    await ref.set({ music: [...current, ...add] }, { merge: true })
    console.log('✓ yazıldı')
  }
  process.exit(0)
}
void main()
