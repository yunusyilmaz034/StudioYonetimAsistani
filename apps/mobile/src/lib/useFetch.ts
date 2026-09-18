// Minimal data hook: run an async loader, expose { data, loading, error, reload }. Keeps every screen
// free of repeated useState/useEffect plumbing without pulling a data-fetching library into v1.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

// ── ARKA PLANDAN DÖNEN UYGULAMA ESKİ VERİ GÖSTERİYORDU (owner, 2026-09-18) ──────────────────
//
// *"Uygulama açıldı, dün rezervasyon ajandasına baktı, sonra arka plana aldı. Bir gün sonra tekrar
// açtı; yenilenme olmadığı için eski ajandayı görüyor, 'boşmuş' diyor ama dolu çıkıyor, alamıyorum
// diye bizi arıyor."*
//
// Sebep: yükleme YALNIZCA ekran ilk kurulduğunda çalışıyordu. Telefonda ekran kurulu kalır — üye
// uygulamayı kapatmaz, arka plana atar. Ertesi gün öne getirdiğinde React hiçbir şey yeniden
// çalıştırmaz, ve ekranda dünün dersleri durur. Üye için bu bir hata mesajı değil, YANLIŞ BİR
// GERÇEKLİK: dolu dersi boş görür, rezerve edemez, ve arayıp sorar.
//
// İki tetikleyici var, ikisi de gerekli:
//   • Öne dönüş + son yüklemeden bu yana 60 sn geçmiş → tazele. Eşik, uygulamalar arasında saniyede
//     bir gidip gelen kullanıcıyı boşuna sorgu yağmuruna tutmamak için.
//   • GÜN DEĞİŞMİŞ → süreye bakmadan tazele. Ajanda "bugün"ü açılış anına göre kuruyor; gün
//     dönmüşse ekrandaki her şey bir gün kaymış demektir ve 60 sn eşiği burada anlamsız kalır.
//
// Tazeleme SESSİZ: `loading` true yapılmaz, yoksa öne her gelişte ekran iskelete döner ve göz
// yanıp söner. Veri geldiğinde yerine geçer; kullanıcı yalnızca doğru sayıyı görür.
const TAZELEME_ESIGI_MS = 60_000
const gunKey = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

export function useFetch<T>(loader: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Son BAŞARILI yüklemenin anı. Başarısız denemeler sayılmaz: hata alan ekran, öne dönüldüğünde
  // yeniden denemeyi hak eder.
  const sonYukleme = useRef(0)

  const calistir = useCallback(
    async (sessiz: boolean) => {
      if (!sessiz) setLoading(true)
      setError(null)
      try {
        setData(await loader())
        sonYukleme.current = Date.now()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  )

  const reload = useCallback(() => calistir(false), [calistir])

  useEffect(() => {
    let alive = true
    setLoading(true)
    loader()
      .then((d) => {
        if (!alive) return
        setData(d)
        sonYukleme.current = Date.now()
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') return
      const simdi = Date.now()
      const gunDegisti = sonYukleme.current > 0 && gunKey(sonYukleme.current) !== gunKey(simdi)
      if (gunDegisti || simdi - sonYukleme.current > TAZELEME_ESIGI_MS) void calistir(true)
    })
    return () => sub.remove()
  }, [calistir])

  return { data, loading, error, reload }
}
