'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon, PlusIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Textarea } from '@/components/ui/textarea'
import { getAiSettingsAction, setAiSettingsAction, type AiFaq } from '@/server/actions/ai-settings'

// Ayarlar → AI Ayarları — the studio's "knowledge card". What the owner writes here is what the AI knows:
// its tone, the studio's basics, policies, FAQ, and the rules for when to hand off / what never to do.
// Data, not code — edited live, no deploy. Feeds the dashboard checklist's voice and, later, the WhatsApp
// receptionist's full knowledge.
export function AiSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const [tone, setTone] = useState('')
  const [identity, setIdentity] = useState('')
  const [basics, setBasics] = useState('')
  const [policies, setPolicies] = useState('')
  const [faq, setFaq] = useState<AiFaq[]>([])
  const [escalation, setEscalation] = useState('')
  const [neverDo, setNeverDo] = useState('')
  const [examples, setExamples] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getAiSettingsAction()
      .then((s) => {
        setTone(s.tone)
        setIdentity(s.identity)
        setBasics(s.basics)
        setPolicies(s.policies)
        setFaq(s.faq.length > 0 ? [...s.faq] : [])
        setEscalation(s.escalation)
        setNeverDo(s.neverDo)
        setExamples(s.examples)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function patchFaq(i: number, patch: Partial<AiFaq>) {
    setFaq((list) => list.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  async function save() {
    setSaving(true)
    try {
      const r = await setAiSettingsAction({
        tone: tone.trim(),
        identity: identity.trim(),
        basics: basics.trim(),
        policies: policies.trim(),
        faq: faq.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q || f.a),
        escalation: escalation.trim(),
        neverDo: neverDo.trim(),
        examples: examples.trim(),
      })
      if (r.ok) toast.success('AI ayarları kaydedildi.')
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setSaving(false)
  }

  if (loading) return <div className="flex justify-center py-10"><Loader2Icon className="animate-spin text-muted-foreground" /></div>

  const field = (label: string, hint: string, value: string, set: (v: string) => void, rows = 3, placeholder = '') => (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Textarea value={value} onChange={(e) => set(e.target.value)} rows={rows} placeholder={placeholder} disabled={!canEdit} />
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
        <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          AI asistanın <strong className="text-foreground">buradan öğrenir</strong>. Ne kadar dolu olursa, resepsiyondaki
          deneyimli bir çalışan gibi o kadar iyi konuşur. Fiyat/program gibi bilgileri buraya yazma — onları sistemden
          canlı okur; buraya "yazılı olmayan" bilgileri yaz.
        </p>
      </div>

      <Section title="Kimlik & üslup" hint="AI kim gibi konuşsun? Ton, dil ve karakter.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ton</label>
            <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Örn. Samimi, sıcak, sen dili; kısa ve net." disabled={!canEdit} />
          </div>
          {field('Kimlik / karakter', 'AI kendini nasıl tanıtsın, hangi rolde? (Örn. "Pilates Fitness by Işıl resepsiyonuyum, size yardımcı olmak için buradayım.")', identity, setIdentity, 2)}
        </div>
      </Section>

      <Section title="Temel bilgiler" hint="Çalışma saatleri, adres, otopark, ulaşım, kadınlara özel notu — katalogda olmayan her şey.">
        {field('Temel bilgiler', 'Serbestçe yaz; AI bunları soru gelince kullanır.', basics, setBasics, 5, 'Örn.\nÇalışma saatleri: Hafta içi 07:00–22:00, Cumartesi 09:00–18:00.\nAdres: Akse Mah. ... / Çayırova. Burger King yanı.\nOtopark: Var, ücretsiz.\nKadınlara özel bir stüdyoyuz.')}
      </Section>

      <Section title="Politikalar" hint="Deneme dersi, iptal, dondurma, ilk gelişte ne getirmeli — katalogda olmayan kurallar.">
        {field('Politikalar', 'Serbestçe yaz.', policies, setPolicies, 5, 'Örn.\nDeneme dersi: İlk ders ücretsiz, randevuyla.\nİlk gelişte: Rahat kıyafet + çorap yeterli.\nDondurma: Aylık paketlerde 1 hafta hakkı.')}
      </Section>

      <Section title="Sık Sorulan Sorular" hint="Sık gelen sorular ve verdiğiniz gerçek cevaplar. (WhatsApp geçmişinizden birlikte doldurabiliriz.)">
        <div className="space-y-3">
          {faq.length === 0 ? <p className="text-sm text-muted-foreground">Henüz soru yok. “Soru Ekle” ile başla.</p> : null}
          {faq.map((f, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Soru {i + 1}</span>
                {canEdit ? (
                  <Button type="button" variant="ghost" size="icon" onClick={() => setFaq((l) => l.filter((_, idx) => idx !== i))} title="Sil">
                    <Trash2Icon className="size-4 text-destructive" />
                  </Button>
                ) : null}
              </div>
              <Input value={f.q} onChange={(e) => patchFaq(i, { q: e.target.value })} placeholder="Soru — örn. Erkekler gelebilir mi?" disabled={!canEdit} />
              <Textarea value={f.a} onChange={(e) => patchFaq(i, { a: e.target.value })} rows={2} placeholder="Cevap — örn. Stüdyomuz kadınlara özeldir." disabled={!canEdit} />
            </div>
          ))}
          {canEdit ? (
            <Button type="button" variant="outline" onClick={() => setFaq((l) => [...l, { q: '', a: '' }])} disabled={faq.length >= 60}>
              <PlusIcon className="size-4" /> Soru Ekle
            </Button>
          ) : null}
        </div>
      </Section>

      <Section title="İnsana devret" hint="AI ne zaman durup Işıl'a / resepsiyona devretsin?">
        {field('Devretme kuralları', 'Her satıra bir durum yaz.', escalation, setEscalation, 4, 'Örn.\nMüşteri "insanla görüşmek istiyorum" derse.\nŞikayet / iade / özel durum olursa.\nEmin olmadığın bir şey sorulursa.\nSağlık sorunu / sakatlık konuşulursa.')}
      </Section>

      <Section title="Asla yapma" hint="AI'nın kesinlikle yapmayacağı şeyler.">
        {field('Yasaklar', 'Her satıra bir kural yaz.', neverDo, setNeverDo, 4, 'Örn.\nFiyat pazarlığı yapma, indirim sözü verme.\nKesin taahhütte bulunma ("kesin ayarlarım" deme).\nTıbbi/sağlık tavsiyesi verme.\nBilmediğin bir şeyi uydurma — devret.')}
      </Section>

      <Section title="Örnek konuşmalar (opsiyonel)" hint="Deneyimli personelin nasıl konuştuğuna dair örnekler. AI üslubu buradan da öğrenir.">
        {field('Örnekler', 'Birkaç örnek diyalog ya da cümle.', examples, setExamples, 5)}
      </Section>

      {canEdit ? (
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : null} Kaydet
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">AI ayarlarını yalnızca işletme sahibi düzenleyebilir.</p>
      )}
    </div>
  )
}
