import type { Metadata } from 'next'

import { LegalSection, LegalShell, SellerIdentity } from '@/components/legal-shell'
import { LEGAL_DOCS, RULES, SELLER } from '@/lib/legal'

// KVKK AYDINLATMA METNİ — separate from the privacy policy and separate from consent, because they
// are three different legal acts. Aydınlatma is us telling you; açık rıza is you agreeing; the
// privacy policy is how we keep it safe. Merging them is the most common way a consent turns out to
// be invalid, so /gizlilik links here and this page never asks for anything.
//
// EVERY category listed below is one the system actually stores. The audit that preceded this page
// established what those are: there is no TC kimlik field, no address field, and no accounting or
// e-fatura integration — so none of them are claimed here. Where identity documents are photographed
// and filed, the photograph is named as what it is.

export const metadata: Metadata = {
  title: `KVKK Aydınlatma Metni · ${SELLER.brand}`,
  description: '6698 sayılı KVKK uyarınca kişisel verilerinizin işlenmesine ilişkin aydınlatma metni.',
}

export default function KvkkPage() {
  return (
    <LegalShell title="KVKK Aydınlatma Metni" version={LEGAL_DOCS.kvkk.version}>
      <LegalSection title="1. Veri sorumlusu">
        <p>
          6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca kişisel verileriniz, veri
          sorumlusu sıfatıyla aşağıdaki şirket tarafından işlenmektedir:
        </p>
        <SellerIdentity />
      </LegalSection>

      <LegalSection title="2. İşlenen kişisel veriler">
        <p>Hizmetin gerektirdiği ölçüde aşağıdaki verileriniz işlenir:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Kimlik:</strong> ad-soyad, doğum tarihi
          </li>
          <li>
            <strong>İletişim:</strong> cep telefonu numarası, e-posta adresi, acil durumda aranacak
            kişi bilgisi
          </li>
          <li>
            <strong>Üyelik ve hizmet kullanımı:</strong> satın alınan paket, paket başlangıç-bitiş
            tarihleri, kalan ders/giriş hakkı, rezervasyon kayıtları, derse katılım ve stüdyoya giriş
            kayıtları, dondurma ve iptal işlemleri
          </li>
          <li>
            <strong>Finans:</strong> ödeme tutarı, ödeme yöntemi, ödeme tarihi, tahsilat ve iade
            kayıtları, borç-alacak durumu
          </li>
          <li>
            <strong>Müşteri iletişimi:</strong> WhatsApp, telefon ve e-posta üzerinden tarafımıza
            ilettiğiniz talep, soru ve şikâyetler ile bunlara verilen yanıtlar
          </li>
          <li>
            <strong>Görsel kayıt:</strong> tesis girişindeki güvenlik kamerası kayıtları
          </li>
          <li>
            <strong>Belge görüntüleri:</strong> imzaladığınız üyelik sözleşmesi, aydınlatma ve açık
            rıza formlarının taranmış/fotoğraflanmış hâlleri. Bu belgelerin üzerinde, formu doldururken
            beyan ettiğiniz kimlik numarası ve adres gibi bilgiler yer alabilir; bu belgeler görüntü
            olarak, erişimi kısıtlı biçimde saklanır.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Özel nitelikli kişisel veriler (sağlık verileri)">
        <p>
          Hizmetin güvenli ve kişiye uygun şekilde sunulabilmesi için, <strong>yalnızca açık
          rızanız</strong> ile aşağıdaki özel nitelikli verileriniz işlenebilir:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            beyan ettiğiniz rahatsızlık, sakatlık ve ameliyat geçmişi ile varsa doktor raporu
            içeriği,
          </li>
          <li>
            vücut ölçüm ve analiz değerleri (kilo, yağ ve kas oranı, çevre ölçüleri, vücut kitle
            indeksi ve benzeri),
          </li>
          <li>izin vermeniz hâlinde gelişim takibi amacıyla çekilen fotoğraflar,</li>
          <li>egzersiz sırasında bildirdiğiniz ağrı/zorlanma geri bildirimleri.</li>
        </ul>
        <p>
          Sağlık verileriniz diğer kişisel verilerinizden ayrı olarak değerlendirilir, yalnızca bu
          verilere ihtiyaç duyan eğitmen ve yönetici rolleriyle sınırlı biçimde erişilebilir ve açık
          rızanızı geri almanız hâlinde işlenmesine son verilir. Sağlık verilerinize ilişkin açık rıza
          metnine{' '}
          <a className="text-primary underline" href="/acik-riza-saglik">
            buradan
          </a>{' '}
          ulaşabilirsiniz.
        </p>
      </LegalSection>

      <LegalSection title="4. İşleme amaçları">
        <ul className="list-disc space-y-1 pl-5">
          <li>üyelik sözleşmesinin kurulması ve yürütülmesi, üyelik kaydınızın oluşturulması,</li>
          <li>ders rezervasyonlarının alınması, yönetilmesi ve katılımın takibi,</li>
          <li>satın aldığınız paketin, kalan haklarınızın ve geçerlilik süresinin takibi,</li>
          <li>ödeme, tahsilat, iade ve muhasebe kayıtlarının oluşturulması,</li>
          <li>
            hizmete ilişkin bilgilendirme mesajlarının iletilmesi (rezervasyon teyidi, ders
            hatırlatması, ödeme bildirimi, üyelik işlemleri),
          </li>
          <li>
            açık rızanız bulunması hâlinde, sağlık beyanınıza uygun ve güvenli antrenman programının
            hazırlanması ve gelişiminizin izlenmesi,
          </li>
          <li>tesis ve kişi güvenliğinin sağlanması,</li>
          <li>
            <strong>ayrıca onay vermeniz hâlinde</strong> kampanya, indirim ve duyuruların
            iletilmesi,
          </li>
          <li>talep, soru ve şikâyetlerinizin karşılanması ve hukuki yükümlülüklerimizin yerine getirilmesi.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Hukuki sebepler">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>KVKK m.5/2-c</strong> — sözleşmenin kurulması veya ifasıyla doğrudan doğruya
            ilgili olması (üyelik, rezervasyon, paket ve ödeme verileri),
          </li>
          <li>
            <strong>KVKK m.5/2-ç</strong> — hukuki yükümlülüğümüzün yerine getirilmesi (mali mevzuat
            uyarınca saklanması gereken kayıtlar),
          </li>
          <li>
            <strong>KVKK m.5/2-f</strong> — meşru menfaat (tesis güvenliği, hizmet kalitesinin
            takibi),
          </li>
          <li>
            <strong>KVKK m.5/1 ve m.6/2 — açık rıza</strong> (sağlık verileri ve ticari elektronik
            ileti gönderimi).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Toplama yöntemleri">
        <p>
          Verileriniz; stüdyoda doldurduğunuz üyelik ve sağlık beyan formları, resepsiyonla yaptığınız
          görüşmeler, üye mobil uygulaması ve internet sitemiz üzerinden yaptığınız işlemler, WhatsApp
          ve telefon iletişimi, stüdyo girişindeki güvenlik kamerası ve ödeme adımında ödeme
          kuruluşundan tarafımıza dönen işlem sonucu bilgileri aracılığıyla, kısmen otomatik ve
          otomatik olmayan yollarla toplanır.
        </p>
      </LegalSection>

      <LegalSection title="7. Verilerin aktarımı">
        <p>Kişisel verileriniz, aşağıdaki hâllerde ve yalnızca gerekli olan ölçüde aktarılır:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Bulut altyapı sağlayıcısı:</strong> Üyelik, rezervasyon ve ödeme kayıtları,
            Google Firebase altyapısında barındırılmaktadır.
          </li>
          <li>
            <strong>Ödeme kuruluşu:</strong> Online ödemelerde işlem bilgileriniz ödeme kuruluşuna
            iletilir. <strong>Kart bilgileriniz tarafımızca görülmez ve saklanmaz</strong>; ödeme,
            ödeme kuruluşunun kendi güvenli sayfası üzerinden gerçekleşir.
          </li>
          <li>
            <strong>İleti sağlayıcıları:</strong> Size gönderilen e-posta ve WhatsApp mesajlarının
            iletilebilmesi için ad ve iletişim bilginiz ilgili servis sağlayıcıya aktarılır.
          </li>
          <li>
            <strong>Yetkili kamu kurumları:</strong> Mevzuattan doğan bir yükümlülük veya usulüne
            uygun bir talep bulunması hâlinde.
          </li>
        </ul>
        <p>
          Verileriniz bunların dışında üçüncü kişilerle paylaşılmaz, satılmaz ve pazarlama amacıyla
          devredilmez.
        </p>
      </LegalSection>

      <LegalSection title="8. Saklama süreleri">
        <ul className="list-disc space-y-1 pl-5">
          <li>Üyelik, rezervasyon ve hizmet kullanım kayıtları: üyeliğinizin sona ermesinden itibaren 10 yıl,</li>
          <li>Ödeme, tahsilat ve muhasebe kayıtları: mali mevzuat uyarınca 10 yıl,</li>
          <li>
            Güvenlik kamerası kayıtları: <strong>{RULES.cameraRetentionDays} gün</strong>,
          </li>
          <li>Sağlık verileri ve ölçüm kayıtları: açık rızanızın geri alınmasına kadar, en geç üyelik bitiminden 10 yıl sonrasına kadar,</li>
          <li>Ticari elektronik ileti onay kayıtları: onayın geri alınmasından itibaren 3 yıl.</li>
        </ul>
      </LegalSection>

      <LegalSection title="9. Haklarınız (KVKK m.11)">
        <p>Veri sorumlusuna başvurarak;</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>kişisel verinizin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme,</li>
          <li>işleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
          <li>yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,</li>
          <li>eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
          <li>işlenmesini gerektiren sebepler ortadan kalkmışsa silinmesini veya yok edilmesini isteme,</li>
          <li>düzeltme, silme ve yok etme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme,</li>
          <li>münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonuç doğmasına itiraz etme,</li>
          <li>kanuna aykırı işleme sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme</li>
        </ul>
        <p>
          haklarına sahipsiniz. Başvurularınızı{' '}
          <a className="text-primary underline" href={`mailto:${SELLER.email}`}>
            {SELLER.email}
          </a>{' '}
          adresine e-posta ile veya {SELLER.address} adresine yazılı olarak iletebilirsiniz.
          Başvurunuz en geç <strong>30 gün</strong> içinde sonuçlandırılır. Üye mobil uygulamasındaki
          hesap ayarları bölümünden hesabınızın silinmesini de doğrudan talep edebilirsiniz.
        </p>
      </LegalSection>

      <LegalSection title="10. Bu metin ile açık rıza arasındaki fark">
        <p>
          Bu metin bir <strong>aydınlatma</strong> metnidir; verilerinizin nasıl işlendiğini
          açıklar ve tek başına bir onay anlamına gelmez. Sağlık verilerinin işlenmesi ve pazarlama
          amaçlı ileti gönderimi gibi açık rıza gerektiren hâllerde, rızanız ayrıca ve açıkça, ayrı
          bir kutucuk aracılığıyla alınır. Rızanızı vermemeniz üyelik veya satın alma hakkınızı
          etkilemez ve rızanızı her zaman geri alabilirsiniz.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
