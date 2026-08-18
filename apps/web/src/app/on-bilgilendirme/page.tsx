import type { Metadata } from 'next'

import { LegalRow, LegalSection, LegalShell, SellerIdentity } from '@/components/legal-shell'
import { LEGAL_DOCS, RULES, SELLER } from '@/lib/legal'
import { getPublicProductsAction } from '@/server/actions/payments'

// ÖN BİLGİLENDİRME FORMU — dynamic per package.
//
// `?s=<studioId>&p=<productId>` renders the package's own figures; without them the page still renders
// as the general form, because it is also a footer link that must work when nobody is buying anything.
// The package block is read from the SAME public action the sales page and the marketing site read, so
// the price quoted here cannot drift from the price charged — it is one query against one catalogue.

export const metadata: Metadata = {
  title: `Ön Bilgilendirme Formu · ${SELLER.brand}`,
  description: 'Mesafeli satış öncesi zorunlu ön bilgilendirme formu.',
}

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

export default async function PreInfoPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; p?: string }>
}) {
  const sp = await searchParams
  const res = sp.s ? await getPublicProductsAction({ studioId: sp.s }) : null
  const product = res?.ok && sp.p ? res.items.find((i) => i.id === sp.p) : undefined
  const twoPrices = product ? product.cashKurus !== product.totalKurus : false

  return (
    <LegalShell title="Ön Bilgilendirme Formu" version={LEGAL_DOCS.preinfo.version}>
      <LegalSection title="1. Satıcı bilgileri">
        <SellerIdentity />
      </LegalSection>

      <LegalSection title="2. Sözleşme konusu hizmet">
        {product ? (
          <dl className="rounded-xl border border-neutral-200 bg-neutral-50/60 px-4 py-2">
            <LegalRow label="Paket adı">{product.name}</LegalRow>
            <LegalRow label="Hizmet">Stüdyoda yüz yüze sunulan spor hizmeti (kadınlara özel)</LegalRow>
            {product.description ? <LegalRow label="Paket içeriği">{product.description}</LegalRow> : null}
            <LegalRow label="Paket süresi">{product.durationDays} gün</LegalRow>
            <LegalRow label="Toplam bedel (KDV dâhil)">
              {twoPrices ? (
                <>
                  Kredi kartı ile <strong>{tl(product.totalKurus)}</strong> · Stüdyoda nakit{' '}
                  <strong>{tl(product.cashKurus)}</strong>
                </>
              ) : (
                <strong>{tl(product.totalKurus)}</strong>
              )}
            </LegalRow>
            <LegalRow label="Ödeme şekli">
              Kredi kartı ile online ödeme. Taksit seçeneği sunulan paketlerde taksit sayısına göre
              bankanız/ödeme kuruluşu tarafından vade farkı uygulanabilir; ödeyeceğiniz net tutarı
              ödeme adımında görürsünüz.
            </LegalRow>
            <LegalRow label="Başlangıç koşulu">
              Paketiniz, satın alma sırasında belirlenen başlangıç tarihinde aktif olur ve süresi bu
              tarihten itibaren işler.
            </LegalRow>
          </dl>
        ) : (
          <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            Bu form, satın alacağınız pakete göre doldurulur. Paketinize ait ad, içerik, süre ve
            toplam bedel bilgileri <strong>ödeme adımından önce</strong> bu formda size gösterilir.
            Aşağıdaki genel koşullar tüm paketler için geçerlidir.
          </p>
        )}
        <p>
          Hizmetin tamamı {SELLER.address} adresindeki stüdyomuzda, yüz yüze sunulur ve{' '}
          <strong>kadınlara özeldir</strong>. Paketler kişiye özeldir, başkasına devredilemez.
          Paket süresi sonunda kullanılmayan ders kredileri devretmez.
        </p>
      </LegalSection>

      <LegalSection title="3. Cayma hakkı">
        <p>
          Sözleşmenin kurulduğu tarihten itibaren <strong>{RULES.withdrawalDays} gün</strong> içinde
          hiçbir gerekçe göstermeden ve cezai şart ödemeden cayma hakkınız vardır.
        </p>
        <p>
          <strong>Cayma hakkının kullanılması.</strong> {RULES.withdrawalDays} günlük süre içinde{' '}
          <a className="text-[#7A1F3D] underline" href={`mailto:${SELLER.email}`}>
            {SELLER.email}
          </a>{' '}
          adresine e-posta göndermeniz ya da{' '}
          <a className="text-[#7A1F3D] underline" href={`tel:${SELLER.phoneE164}`}>
            {SELLER.phone}
          </a>{' '}
          numarasından yazılı olarak bildirmeniz yeterlidir. Bildiriminizin bize ulaşmasından
          itibaren <strong>14 gün</strong> içinde ödemeniz, yaptığınız ödeme yöntemiyle ve size hiçbir
          masraf yüklenmeksizin iade edilir.
        </p>
        <p>
          <strong>Cayma hakkının istisnaları.</strong> Onayınızla cayma süresi dolmadan{' '}
          <strong>tamamen ifa edilen</strong> hizmetlerde ve belirli bir tarih veya dönemde
          yapılması gereken, boş zamanın değerlendirilmesine ilişkin hizmetlerde (belirli güne ve
          saate ayrılmış ders rezervasyonları) cayma hakkı kullanılamaz. Paketinizi{' '}
          {RULES.withdrawalDays} gün dolmadan kullanmaya başlamak isterseniz, hizmete başlanmadan
          önce bu yönde ayrıca onayınız alınır.
        </p>
      </LegalSection>

      <LegalSection title="4. İptal ve iade koşulları">
        <p>
          Rezervasyon iptali, dondurma, sağlık nedeniyle iade ve kredi kullanımına ilişkin koşulların
          tamamı{' '}
          <a className="text-[#7A1F3D] underline" href="/iptal-iade">
            İptal ve İade Koşulları
          </a>{' '}
          metninde yer alır ve bu formun ayrılmaz parçasıdır. Özetle: Reformer ve grup derslerinde
          rezervasyon dersten en az <strong>{RULES.cancellationWindowHours} saat</strong>, özel
          derste en az <strong>{RULES.privateCancellationWindowHours} saat</strong> önce iptal
          edilmelidir; geç iptal ve derse gelmeme hâlinde <strong>1 kredi</strong> kullanılmış
          sayılır. İşletmeden kaynaklanan iptallerde kredi düşülmez.
        </p>
      </LegalSection>

      <LegalSection title="5. Şikâyet ve uyuşmazlık çözümü">
        <p>
          Şikâyetlerinizi yukarıdaki iletişim kanallarından bize iletebilirsiniz. Çözülemeyen
          uyuşmazlıklarda, Ticaret Bakanlığı'nca her yıl belirlenen parasal sınırlar çerçevesinde
          tüketicinin yerleşim yerindeki veya işlemin yapıldığı yerdeki{' '}
          <strong>Tüketici Hakem Heyetleri</strong> ile <strong>Tüketici Mahkemeleri</strong>{' '}
          yetkilidir.
        </p>
      </LegalSection>

      <LegalSection title="6. Onay">
        <p>
          Bu Ön Bilgilendirme Formu, ödeme adımından önce tarafınıza sunulur. Ödeme sayfasındaki
          onay kutusunu işaretleyerek bu formu ve{' '}
          <a className="text-[#7A1F3D] underline" href="/mesafeli-satis">
            Mesafeli Satış Sözleşmesi
          </a>
          'ni okuduğunuzu ve kabul ettiğinizi beyan etmiş olursunuz.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
