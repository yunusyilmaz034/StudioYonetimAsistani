import type { Metadata } from 'next'

import { LegalSection, LegalShell } from '@/components/legal-shell'
import { LEGAL_DOCS, SELLER } from '@/lib/legal'

// SAĞLIK VERİLERİNE İLİŞKİN AÇIK RIZA METNİ.
//
// Short on purpose. An açık rıza that runs to three pages is one nobody read, and a consent nobody
// read is a consent that does not hold. It states exactly which data, exactly why, exactly who sees
// it, and that saying no changes nothing about the membership — that last sentence is what makes the
// rest of it valid, because a consent that is a condition of service is not freely given.

export const metadata: Metadata = {
  title: `Sağlık Verilerine İlişkin Açık Rıza Metni · ${SELLER.brand}`,
  description: 'Sağlık verilerinizin işlenmesine ilişkin açık rıza metni.',
}

export default function HealthConsentPage() {
  return (
    <LegalShell title="Sağlık Verilerine İlişkin Açık Rıza Metni" version={LEGAL_DOCS.health_consent.version}>
      <LegalSection title="Neden istiyoruz">
        <p>
          Size uygun ve güvenli bir antrenman programı hazırlayabilmemiz, egzersiz sırasında
          zorlanmanızı veya sakatlanmanızı önleyebilmemiz ve gelişiminizi takip edebilmemiz için
          sağlık durumunuza ilişkin bazı bilgilere ihtiyaç duyarız. Bu bilgiler KVKK'nın 6.
          maddesi kapsamında <strong>özel nitelikli kişisel veri</strong>dir ve yalnızca{' '}
          <strong>açık rızanızla</strong> işlenebilir.
        </p>
      </LegalSection>

      <LegalSection title="Hangi verileri işleriz">
        <ul className="list-disc space-y-1 pl-5">
          <li>beyan ettiğiniz rahatsızlık, sakatlık, ameliyat ve kronik hastalık bilgileri,</li>
          <li>varsa tarafınızca paylaşılan doktor raporu içeriği,</li>
          <li>
            vücut ölçüm ve analiz değerleri: kilo, yağ ve kas oranı, su oranı, çevre ölçüleri, vücut
            kitle indeksi, bazal metabolizma hızı ve benzeri,
          </li>
          <li>ayrıca izin vermeniz hâlinde gelişim takibi amacıyla çekilen fotoğraflar,</li>
          <li>egzersiz sırasında bildirdiğiniz ağrı ve zorlanma geri bildirimleri.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Kimler görebilir">
        <p>
          Bu veriler yalnızca size program hazırlayan <strong>eğitmeniniz</strong> ve stüdyo{' '}
          <strong>yönetimi</strong> tarafından, yalnızca yukarıdaki amaçlarla görülebilir. Üçüncü
          kişilerle paylaşılmaz, pazarlama amacıyla kullanılmaz ve yurt dışına aktarılmaz.
        </p>
      </LegalSection>

      <LegalSection title="Ne kadar süreyle saklarız">
        <p>
          Verileriniz, açık rızanızı geri aldığınız ana kadar saklanır. Rızanızı geri aldığınızda
          sağlık verileriniz ve ölçüm kayıtlarınız silinir veya anonim hâle getirilir. Mevzuattan
          doğan bir saklama yükümlülüğü varsa yalnızca o kapsamda ve o süreyle sınırlı olarak
          saklanır.
        </p>
      </LegalSection>

      <LegalSection title="Rıza vermezseniz ne olur">
        <p>
          Bu rızayı vermek <strong>tamamen isteğe bağlıdır</strong>. Rıza vermemeniz üyeliğinizi,
          paket satın almanızı veya derslere katılmanızı hiçbir şekilde etkilemez. Yalnızca kişiye
          özel program hazırlama ve ölçüm takibi hizmetlerinden yararlanamazsınız.
        </p>
      </LegalSection>

      <LegalSection title="Rızanızı nasıl geri alırsınız">
        <p>
          Rızanızı dilediğiniz zaman, herhangi bir gerekçe göstermeden geri alabilirsiniz.
          Resepsiyona sözlü olarak bildirmeniz ya da{' '}
          <a className="text-[#7A1F3D] underline" href={`mailto:${SELLER.email}`}>
            {SELLER.email}
          </a>{' '}
          adresine e-posta göndermeniz yeterlidir. Geri alma, o ana kadar hukuka uygun şekilde
          yapılmış işlemeleri geçersiz kılmaz.
        </p>
      </LegalSection>

      <LegalSection title="Rıza beyanı">
        <p className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
          “Sağlık bilgilerimin, sunulacak spor hizmetinin güvenli ve kişisel durumuma uygun şekilde
          yürütülmesi amacıyla yukarıda açıklanan kapsamda işlenmesine ilişkin bu metni okudum ve{' '}
          <strong>açık rıza veriyorum</strong>.”
        </p>
      </LegalSection>
    </LegalShell>
  )
}
