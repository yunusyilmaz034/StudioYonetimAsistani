import type { Metadata } from 'next'

import { LegalSection, LegalShell, SellerIdentity } from '@/components/legal-shell'
import { RULES, SELLER } from '@/lib/legal'

// İLETİŞİM BİLGİLERİ — the page a payment institution looks for first, and the one a customer looks
// for when something has gone wrong. A yurtiçi açık adres and a reachable telephone number are a
// formal requirement for a site that sells online; they are also the difference between a complaint
// and a chargeback.

export const metadata: Metadata = {
  title: `İletişim Bilgileri · ${SELLER.brand}`,
  description: `${SELLER.legalName} açık adres, telefon ve e-posta bilgileri.`,
}

export default function ContactPage() {
  return (
    <LegalShell title="İletişim Bilgileri">
      <LegalSection title="Satıcı / Hizmet Sağlayıcı">
        <SellerIdentity />
      </LegalSection>

      <LegalSection title="Bize nasıl ulaşırsınız">
        <p>
          Üyelik, rezervasyon, ödeme, iptal ve iade talepleriniz ile kişisel verilerinize ilişkin
          başvurularınız için aşağıdaki kanallardan bize ulaşabilirsiniz. Telefon ve WhatsApp
          hattımız stüdyo çalışma saatleri içinde yanıtlanır.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Telefon / WhatsApp:</strong>{' '}
            <a className="text-[#7A1F3D] underline" href={`tel:${SELLER.phoneE164}`}>
              {SELLER.phone}
            </a>
          </li>
          <li>
            <strong>E-posta:</strong>{' '}
            <a className="text-[#7A1F3D] underline" href={`mailto:${SELLER.email}`}>
              {SELLER.email}
            </a>
          </li>
          <li>
            <strong>Adres:</strong> {SELLER.address}
          </li>
        </ul>
        <p>
          Yazılı başvurularınızı yukarıdaki adrese ıslak imzalı olarak veya {SELLER.email} adresine
          e-posta ile iletebilirsiniz. Başvurularınız en geç <strong>30 gün</strong> içinde
          yanıtlanır.
        </p>
      </LegalSection>

      <LegalSection title="Hizmet verdiğimiz alan">
        <p>
          Fitness, Reformer Pilates ve özel ders hizmetlerimizin tamamı{' '}
          <strong>kadınlara özeldir</strong> ve yalnızca yukarıdaki adreste bulunan stüdyomuzda,
          yüz yüze sunulur.
        </p>
      </LegalSection>

      <LegalSection title="Güvenlik kamerası bilgilendirmesi">
        <p>
          Tesisimizin yalnızca <strong>giriş bölümünde</strong> güvenlik kamerası bulunmaktadır.
          Kayıtlar, tesis ve kişi güvenliğinin sağlanması, güvenlik olaylarının incelenmesi ve
          gerektiğinde hukuki yükümlülüklerin yerine getirilmesi amacıyla işlenir ve normal koşullarda{' '}
          <strong>{RULES.cameraRetentionDays} gün</strong> saklandıktan sonra silinir. Ayrıntı için
          KVKK Aydınlatma Metni'ne bakabilirsiniz.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
