import type { Metadata } from 'next'

import { LegalRow, LegalSection, LegalShell, SellerIdentity } from '@/components/legal-shell'
import { LEGAL_DOCS, RULES, SELLER } from '@/lib/legal'
import { getPublicProductsAction } from '@/server/actions/payments'

// MESAFELİ SATIŞ SÖZLEŞMESİ — dynamic per package, same mechanism as the pre-information form.
//
// The BUYER's details are deliberately left as a described field rather than printed: this page is
// reachable before anyone has identified themselves, and rendering a name here would mean either
// inventing one or exposing one. The buyer's identity is fixed at the moment of acceptance, in the
// consent record that stores who accepted which version when.

export const metadata: Metadata = {
  title: `Mesafeli Satış Sözleşmesi · ${SELLER.brand}`,
  description: 'Online paket satışlarına ilişkin mesafeli satış sözleşmesi.',
}

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

export default async function DistanceSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; p?: string }>
}) {
  const sp = await searchParams
  const res = sp.s ? await getPublicProductsAction({ studioId: sp.s }) : null
  const product = res?.ok && sp.p ? res.items.find((i) => i.id === sp.p) : undefined
  const twoPrices = product ? product.cashKurus !== product.totalKurus : false

  return (
    <LegalShell title="Mesafeli Satış Sözleşmesi" version={LEGAL_DOCS.distance_sales.version}>
      <LegalSection title="Madde 1 — Taraflar">
        <p>
          <strong>SATICI</strong>
        </p>
        <SellerIdentity />
        <p className="pt-2">
          <strong>ALICI</strong>
        </p>
        <p>
          Satın alma sırasında bildirdiğiniz ad-soyad, telefon ve (verdiyseniz) e-posta bilgileriyle
          tanımlanan tüketicidir. Bu bilgiler ödeme adımında tarafınızca girilir ve sözleşmenin
          kurulduğu an ile birlikte kayıt altına alınır.
        </p>
      </LegalSection>

      <LegalSection title="Madde 2 — Sözleşmenin konusu">
        <p>
          İşbu sözleşmenin konusu, ALICI'nın SATICI'ya ait internet sitesi ve mobil uygulaması
          üzerinden elektronik ortamda siparişini verdiği, aşağıda nitelikleri ve satış fiyatı
          belirtilen hizmetin sunulması ile ilgili olarak 6502 sayılı Tüketicinin Korunması Hakkında
          Kanun ve Mesafeli Sözleşmeler Yönetmeliği hükümleri uyarınca tarafların hak ve
          yükümlülüklerinin belirlenmesidir.
        </p>
      </LegalSection>

      <LegalSection title="Madde 3 — Sözleşme konusu hizmet ve bedeli">
        {product ? (
          <dl className="rounded-xl border border-neutral-200 bg-neutral-50/60 px-4 py-2">
            <LegalRow label="Paket">{product.name}</LegalRow>
            {product.description ? <LegalRow label="İçerik">{product.description}</LegalRow> : null}
            <LegalRow label="Paket süresi">{product.durationDays} gün</LegalRow>
            <LegalRow label="Bedel (KDV dâhil)">
              {twoPrices ? (
                <>
                  Kredi kartı ile <strong>{tl(product.totalKurus)}</strong> · Stüdyoda nakit{' '}
                  <strong>{tl(product.cashKurus)}</strong>
                </>
              ) : (
                <strong>{tl(product.totalKurus)}</strong>
              )}
            </LegalRow>
            <LegalRow label="Ödeme şekli">Kredi kartı ile online ödeme (tek çekim veya taksitli)</LegalRow>
          </dl>
        ) : (
          <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            Satın aldığınız paketin adı, içeriği, süresi ve KDV dâhil bedeli, ödeme adımından önce bu
            sözleşmede ve Ön Bilgilendirme Formu'nda size gösterilir.
          </p>
        )}
        <p>
          Bedele KDV dâhildir. Taksitli ödemelerde taksit sayısına göre bankanız veya ödeme kuruluşu
          tarafından vade farkı uygulanabilir; bu tutar SATICI tarafından belirlenmez ve ödeme
          adımında ALICI'ya gösterilir.
        </p>
      </LegalSection>

      <LegalSection title="Madde 4 — Hizmetin başlangıcı ve süresi">
        <p>
          Paket, satın alma sırasında belirlenen başlangıç tarihinde aktif olur ve yukarıda belirtilen
          süre boyunca geçerlidir. Fitness üyeliklerinde başlangıç tarihi satın alma tarihinden
          itibaren en fazla <strong>1 ay</strong>; Reformer Pilates ve özel ders paketlerinde en fazla{' '}
          <strong>2 hafta</strong> ileri bir tarihe alınabilir.
        </p>
        <p>
          Paket süresi sonunda <strong>kullanılmayan ders kredileri bir sonraki döneme
          devretmez</strong> ve bedeli iade edilmez.
        </p>
      </LegalSection>

      <LegalSection title="Madde 5 — Rezervasyon ve iptal koşulları">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Reformer Pilates ve grup derslerinde rezervasyon, dersin başlangıcından en az{' '}
            <strong>{RULES.cancellationWindowHours} saat</strong> önce iptal edilebilir.
          </li>
          <li>
            Özel derslerde randevu, en az <strong>{RULES.privateCancellationWindowHours} saat</strong>{' '}
            önce iptal edilmelidir.
          </li>
          <li>
            Geç iptal ve derse katılmama (no-show) hâlinde <strong>1 ders kredisi</strong>{' '}
            kullanılmış sayılır.
          </li>
          <li>
            Dersin SATICI'dan (stüdyo veya eğitmen) kaynaklanan sebeplerle iptal edilmesi hâlinde
            ALICI'nın kredisinden düşüm yapılmaz; gerekiyorsa paketin bitiş tarihi uzatılır.
          </li>
          <li>
            Fitness üyeliklerinde paketinizde tanımlı dondurma hakkı, rapor veya gerekçe göstermeden
            kullanılabilir ve dondurulan süre üyelik bitiş tarihine eklenir. Reformer Pilates ve özel
            ders paketlerinde standart dondurma hakkı bulunmamaktadır.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Madde 6 — Kadınlara özel hizmet">
        <p>
          SATICI tarafından sunulan Fitness, Reformer Pilates ve özel ders hizmetlerinin tamamı{' '}
          <strong>yalnızca kadın üyelere yöneliktir</strong>. ALICI, bu koşulu bilerek ve kabul ederek
          sözleşmeyi kurar.
        </p>
      </LegalSection>

      <LegalSection title="Madde 7 — Devir yasağı">
        <p>
          Üyelikler ve ders paketleri <strong>kişiye özeldir</strong>; başka bir kişiye devredilemez,
          kullandırılamaz.
        </p>
      </LegalSection>

      <LegalSection title="Madde 8 — Cayma hakkı">
        <p>
          ALICI, sözleşmenin kurulduğu tarihten itibaren <strong>{RULES.withdrawalDays} gün</strong>{' '}
          içinde hiçbir gerekçe göstermeksizin ve cezai şart ödemeksizin cayma hakkına sahiptir.
          Cayma bildirimi {SELLER.email} adresine e-posta ile veya {SELLER.phone} numarasından yazılı
          olarak yapılabilir. Bildirimin SATICI'ya ulaşmasından itibaren 14 gün içinde bedel, ALICI'nın
          ödeme yaptığı yöntemle iade edilir.
        </p>
        <p>
          ALICI'nın talebi ve açık onayı ile cayma süresi dolmadan hizmete başlanması hâlinde,{' '}
          <strong>hizmetin tamamen ifa edilmesiyle cayma hakkı sona erer</strong>. Hizmetin bir kısmı
          ifa edilmişse cayma hâlinde ifa edilen kısmın bedeli mahsup edilir. Belirli bir tarih veya
          dönemde yapılması gereken, boş zamanın değerlendirilmesine ilişkin hizmetlerde cayma hakkı
          kullanılamaz.
        </p>
      </LegalSection>

      <LegalSection title="Madde 9 — Kişisel verilerin korunması">
        <p>
          ALICI'nın kişisel verileri, 6698 sayılı KVKK ve{' '}
          <a className="text-[#7A1F3D] underline" href="/kvkk">
            KVKK Aydınlatma Metni
          </a>{' '}
          ile{' '}
          <a className="text-[#7A1F3D] underline" href="/gizlilik">
            Gizlilik ve Güvenlik Politikası
          </a>{' '}
          çerçevesinde işlenir. <strong>Kart bilgileri SATICI tarafından saklanmaz</strong>; ödeme,
          ödeme kuruluşunun güvenli ödeme sayfası üzerinden gerçekleştirilir.
        </p>
      </LegalSection>

      <LegalSection title="Madde 10 — Uyuşmazlıkların çözümü">
        <p>
          İşbu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığı'nca her yıl ilan edilen parasal
          sınırlar dâhilinde ALICI'nın yerleşim yerindeki veya işlemin yapıldığı yerdeki{' '}
          <strong>Tüketici Hakem Heyetleri</strong>, bu sınırların üzerindeki uyuşmazlıklarda{' '}
          <strong>Tüketici Mahkemeleri</strong> yetkilidir.
        </p>
      </LegalSection>

      <LegalSection title="Madde 11 — Yürürlük">
        <p>
          ALICI, ödeme adımındaki onay kutusunu işaretleyerek işbu sözleşmenin ve Ön Bilgilendirme
          Formu'nun tüm koşullarını okuduğunu, anladığını ve kabul ettiğini beyan eder. Sözleşme,
          ödemenin onaylanması ile kurulmuş sayılır ve bir örneği ALICI'nın erişimine açık tutulur.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
