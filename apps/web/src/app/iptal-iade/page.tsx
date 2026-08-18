import type { Metadata } from 'next'

import { LegalSection, LegalShell } from '@/components/legal-shell'
import { LEGAL_DOCS, RULES, SELLER } from '@/lib/legal'

// İPTAL VE İADE KOŞULLARI.
//
// Every number in this page comes from `lib/legal.ts` and every rule it states is one the software
// actually enforces. Where a rule is reception's practice rather than the system's, it is written as
// a practice — a contract that promises an automatic behaviour the code does not have is a promise
// that fails at the worst possible moment, in front of a member who has the text open on her phone.

export const metadata: Metadata = {
  title: `İptal ve İade Koşulları · ${SELLER.brand}`,
  description: 'Rezervasyon iptali, cayma hakkı, paket iadesi ve sağlık nedeniyle iade koşulları.',
}

export default function RefundPage() {
  return (
    <LegalShell title="İptal ve İade Koşulları" version={LEGAL_DOCS.refund.version}>
      <LegalSection title="1. Bu metin neyi kapsar">
        <p>
          Bu metin; {SELLER.brand} ({SELLER.legalName}) tarafından satılan üyelik ve ders paketlerinde
          <strong> rezervasyon iptali</strong>, <strong>cayma hakkı</strong> ve{' '}
          <strong>paket iadesi</strong> koşullarını düzenler. Mesafeli Satış Sözleşmesi'nin ayrılmaz
          parçasıdır.
        </p>
      </LegalSection>

      <LegalSection title="2. Rezervasyon iptali (ders iptali)">
        <p>
          Rezervasyon iptali ile paket iadesi farklı şeylerdir. Aşağıdaki kurallar yalnızca tek bir
          derse ait rezervasyonun iptalini düzenler; paketinizin kendisi devam eder.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Reformer Pilates ve grup dersleri:</strong> Rezervasyonunuzu, dersin başlangıç
            saatinden en az <strong>{RULES.cancellationWindowHours} saat</strong> önce uygulamadan
            veya resepsiyondan iptal edebilirsiniz. Bu süre içinde yapılan iptallerde krediniz
            kullanılmaz.
          </li>
          <li>
            <strong>Özel ders (PT):</strong> Randevunuzu en az{' '}
            <strong>{RULES.privateCancellationWindowHours} saat</strong> önce iptal etmeniz gerekir.
          </li>
          <li>
            <strong>Geç iptal ve derse katılmama (no-show):</strong> Yukarıdaki süreler geçtikten
            sonra yapılan iptallerde ve derse gelinmemesi hâlinde{' '}
            <strong>1 ders kredisi kullanılmış sayılır</strong>. Ayrılan yer başka bir üyeye
            verilemediği için bu kural uygulanır.
          </li>
          <li>
            İptal süresi geçtikten sonra iptal talebiniz için resepsiyona ulaşabilirsiniz; kredinin
            iade edilip edilmeyeceği stüdyo yönetiminin değerlendirmesine bağlıdır.
          </li>
        </ul>
        <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          Paketinize özel farklı bir iptal süresi veya iptal hakkı sayısı tanımlanmışsa, satın alma
          sırasında size gösterilen Ön Bilgilendirme Formu'ndaki süre geçerlidir.
        </p>
      </LegalSection>

      <LegalSection title="3. İşletmeden kaynaklanan iptaller">
        <p>
          Dersin stüdyo veya eğitmen kaynaklı olarak iptal edilmesi hâlinde{' '}
          <strong>ders kredinizden düşüm yapılmaz</strong> ve herhangi bir hak kaybı yaşamazsınız.
          Gerekli görülen hâllerde paketinizin bitiş tarihi uygun bir süre uzatılır.
        </p>
      </LegalSection>

      <LegalSection title="4. Cayma hakkı (14 gün)">
        <p>
          Mesafeli olarak (internet üzerinden) satın aldığınız paketlerde, sözleşmenin kurulduğu
          tarihten itibaren <strong>{RULES.withdrawalDays} gün</strong> içinde hiçbir gerekçe
          göstermeden ve cezai şart ödemeden cayma hakkınız vardır.
        </p>
        <p>
          Cayma hakkınızı kullanmak için {RULES.withdrawalDays} günlük süre dolmadan{' '}
          <a className="text-[#7A1F3D] underline" href={`mailto:${SELLER.email}`}>
            {SELLER.email}
          </a>{' '}
          adresine e-posta göndermeniz veya{' '}
          <a className="text-[#7A1F3D] underline" href={`tel:${SELLER.phoneE164}`}>
            {SELLER.phone}
          </a>{' '}
          numarasından bize yazılı olarak bildirmeniz yeterlidir. Bildiriminizin bize ulaştığı
          tarihten itibaren <strong>14 gün</strong> içinde, ödemenizi yaptığınız yöntemle ve
          tarafınıza hiçbir masraf yüklenmeksizin iade ederiz.
        </p>
        <p>
          <strong>Cayma süresi dolmadan hizmete başlanması.</strong> Paketinizi{' '}
          {RULES.withdrawalDays} günlük süre dolmadan kullanmaya başlamak isterseniz, hizmete
          başlanmadan önce bu yönde ayrıca onayınızı alırız. Bu onayı verdiğinizde{' '}
          <strong>hizmet tamamen ifa edilirse cayma hakkınız sona erer</strong>; hizmetin bir kısmı
          kullanılmışsa cayma hâlinde kullandığınız kısmın bedeli mahsup edilir. Paketinizin
          başlangıç tarihi {RULES.withdrawalDays} günlük sürenin bitiminden sonraysa böyle bir onay
          istenmez ve cayma hakkınız tam olarak devam eder.
        </p>
      </LegalSection>

      <LegalSection title="5. Cayma hakkının istisnaları">
        <p>
          Mesafeli Sözleşmeler Yönetmeliği uyarınca, aşağıdaki hâllerde cayma hakkı kullanılamaz:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Onayınızla, cayma süresi sona ermeden <strong>tamamen ifa edilen</strong> hizmetler,
          </li>
          <li>
            Belirli bir tarihte veya dönemde yapılması gereken, <strong>boş zamanın
            değerlendirilmesine ilişkin</strong> hizmetler (ör. belirli bir güne ve saate ayrılmış
            ders rezervasyonu).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Cayma süresi dolduktan sonra paket iadesi">
        <p>
          {RULES.withdrawalDays} günlük cayma süresi dolduktan sonra, kullanılmamış paketler için
          iade zorunluluğumuz bulunmamaktadır. Bununla birlikte aşağıdaki durumlarda stüdyo yönetimi
          talebinizi değerlendirir:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Sağlık nedeniyle iade.</strong> Spora veya derslere devam edemeyeceğinizin
            geçerli bir sağlık raporuyla belgelenmesi hâlinde, <strong>kullanılmamış</strong> hizmet
            bölümü için iade süreci uygulanabilir. Kullanılmış dersler ve geçmiş üyelik günleri
            hesaba katılır; iade yalnızca kalan kısım üzerinden yapılır. Bu işlem stüdyo yönetiminin
            onayına tabidir ve kayıt altına alınır.
          </li>
          <li>
            <strong>Dondurma.</strong> Fitness üyeliklerinde, paketinizde tanımlı dondurma hakkını
            rapor veya gerekçe göstermeden kullanabilirsiniz. Dondurulan süre üyeliğinizin bitiş
            tarihine eklenir. Dondurma hakkının kaç gün olduğu paketinize göre değişir ve satın alma
            sırasında Ön Bilgilendirme Formu'nda belirtilir. Reformer Pilates ve özel ders
            paketlerinde standart dondurma hakkı bulunmamaktadır.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Kullanılmayan derslerin devri">
        <p>
          Paket süresi sonunda <strong>kullanılmayan ders kredileri bir sonraki döneme
          devretmez</strong> ve iade edilmez. Paketler <strong>kişiye özeldir</strong>; başka bir
          kişiye devredilemez.
        </p>
      </LegalSection>

      <LegalSection title="8. İadenin yapılma şekli">
        <p>
          Onaylanan iadeler, ödemenin yapıldığı yöntemle gerçekleştirilir. Kredi kartı ile yapılan
          ödemelerde iade tutarı bankanıza tarafımızca iletilir; tutarın kartınıza yansıma süresi
          bankanızın işleyişine bağlıdır ve bu süre bizim kontrolümüzde değildir.
        </p>
      </LegalSection>

      <LegalSection title="9. Uyuşmazlık çözümü">
        <p>
          Şikâyet ve itirazlarınızı öncelikle yukarıdaki iletişim kanallarından bize iletmenizi rica
          ederiz. Çözülemeyen uyuşmazlıklarda, Ticaret Bakanlığı'nca her yıl belirlenen parasal
          sınırlar çerçevesinde, tüketicinin yerleşim yerindeki veya işlemin yapıldığı yerdeki{' '}
          <strong>Tüketici Hakem Heyetleri</strong> ile <strong>Tüketici Mahkemeleri</strong>{' '}
          yetkilidir.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
