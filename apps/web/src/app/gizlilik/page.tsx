import type { Metadata } from 'next'

// PUBLIC privacy policy — the URL the App Store / Play Store listings point to, and the KVKK
// aydınlatma metni for members. It lives OUTSIDE the (staff) route group, so it carries no admin
// shell and needs no session; `/gizlilik` is on the middleware public allowlist.
//
// ── OWNER: fill the legal identity below (veri sorumlusu) ─────────────────────────────────────
// These are the only blanks. Everything else is written to match what the app actually does. Replace
// the placeholders with the studio's registered details, then it is ready to submit to the stores.
const CONTROLLER = {
  legalName: 'Retro Spor Hizmetleri Tic. Ltd. Şti.',
  address: 'Akse Mah. Karasu Cad. No: 28/T, Çayırova / Kocaeli',
  email: 'yunusyilmaz034@gmail.com',
  phone: '0533 199 41 23',
  brand: 'Pilates Fitness by Işıl',
}
const UPDATED = '20 Temmuz 2026'

export const metadata: Metadata = {
  title: 'Gizlilik Politikası ve KVKK Aydınlatma Metni · Pilates Fitness by Işıl',
  description: 'Kişisel verilerinizi nasıl işlediğimize dair aydınlatma metni ve gizlilik politikası.',
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-xl font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-neutral-700">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <header className="space-y-2 border-b border-neutral-200 pb-6">
        <p className="text-sm font-medium tracking-wide text-[#7A1F3D] uppercase">{CONTROLLER.brand}</p>
        <h1 className="text-2xl font-bold text-neutral-900 sm:text-3xl">
          Gizlilik Politikası ve KVKK Aydınlatma Metni
        </h1>
        <p className="text-sm text-neutral-500">Son güncelleme: {UPDATED}</p>
      </header>

      <div className="mt-8 space-y-9">
        <Section id="giris" title="1. Giriş">
          <p>
            Bu metin; {CONTROLLER.brand} tarafından sunulan mobil uygulama, üye portalı ve stüdyo yönetim
            hizmetleri (birlikte “Hizmetler”) kapsamında kişisel verilerinizin nasıl işlendiğini, 6698
            sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca açıklar. Hizmetleri kullanarak bu
            metinde açıklanan işleme faaliyetlerini okuduğunuzu kabul edersiniz.
          </p>
        </Section>

        <Section id="veri-sorumlusu" title="2. Veri Sorumlusu">
          <p>Kişisel verileriniz, veri sorumlusu sıfatıyla aşağıdaki işletme tarafından işlenir:</p>
          <ul className="space-y-1">
            <li>
              <strong>Ünvan:</strong> {CONTROLLER.legalName}
            </li>
            <li>
              <strong>Adres:</strong> {CONTROLLER.address}
            </li>
            <li>
              <strong>E-posta:</strong> {CONTROLLER.email}
            </li>
            <li>
              <strong>Telefon:</strong> {CONTROLLER.phone}
            </li>
          </ul>
        </Section>

        <Section id="veriler" title="3. İşlediğimiz Kişisel Veriler">
          <p>Hizmetleri kullanımınıza bağlı olarak aşağıdaki veri kategorilerini işleriz:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Kimlik ve iletişim:</strong> ad-soyad, telefon numarası (giriş kimliğiniz olarak
              kullanılır). Telefon numaranız uluslararası biçime (E.164) normalleştirilerek saklanır.
            </li>
            <li>
              <strong>Hesap ve kimlik doğrulama:</strong> şifreniz (şifrelenmiş olarak, kimlik doğrulama
              sağlayıcımız tarafından tutulur; tarafımızca açık metin görülmez).
            </li>
            <li>
              <strong>Üyelik ve kullanım:</strong> satın aldığınız paketler, kredi/hak bakiyeniz,
              rezervasyonlarınız, derse giriş (check-in) ve katılım kayıtlarınız.
            </li>
            <li>
              <strong>Ödeme:</strong> ödeme tutarları ve işlem kayıtları ile cüzdan bakiyeniz.{' '}
              <strong>Kart bilgileriniz tarafımızca saklanmaz</strong>; ödemeler yetkili ödeme kuruluşu
              (PAYTR) üzerinden alınır ve kart verileri yalnızca onun güvenli altyapısında işlenir.
            </li>
            <li>
              <strong>Konum (yalnızca açık rızanızla):</strong> QR ile giriş sırasında, yalnızca kendi
              telefonunuzdan ve <strong>onay verdiyseniz</strong>, yaklaşık (yaklaşık 1 km hassasiyetinde,
              tam adres değil) konumunuz. Aşağıdaki 6. bölüme bakınız.
            </li>
            <li>
              <strong>Görsel:</strong> profil fotoğrafınız ve (varsa) antrenman gelişim fotoğraflarınız;
              ayrıca resepsiyonda imzaladığınız üyelik sözleşmesi, KVKK aydınlatma ve açık rıza
              belgelerinizin görüntüsü.
            </li>
            <li>
              <strong>Sağlık/ölçüm (özel nitelikli, yalnızca açık rızanızla):</strong> antrenman kapsamında
              kaydedilen beden ölçümleriniz ve program bilgileriniz.
            </li>
            <li>
              <strong>Cihaz ve teknik:</strong> bildirim gönderebilmek için cihaz bildirim jetonu; uygulama
              kararlılığı ve kullanım analizi için cihaz türü, uygulama sürümü ve olay kayıtları (kimliğinizi
              açık etmeyen teknik veriler).
            </li>
          </ul>
        </Section>

        <Section id="amaclar" title="4. İşleme Amaçları">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Üyeliğinizi ve rezervasyonlarınızı yönetmek, derse girişinizi kaydetmek</li>
            <li>Satın alma, ödeme ve cüzdan işlemlerini yürütmek</li>
            <li>Size hatırlatma ve bilgilendirme bildirimleri göndermek</li>
            <li>Antrenman programı ve (rızanızla) gelişim takibini sağlamak</li>
            <li>Hizmet güvenliğini sağlamak, kötüye kullanımı önlemek</li>
            <li>Uygulama hatalarını gidermek ve hizmeti iyileştirmek</li>
            <li>Yasal yükümlülüklerimizi yerine getirmek</li>
          </ul>
        </Section>

        <Section id="hukuki-sebep" title="5. Hukuki Sebepler">
          <p>Kişisel verileriniz KVKK m. 5 ve 6 kapsamında şu hukuki sebeplere dayanır:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Sözleşmenin kurulması/ifası:</strong> üyelik, rezervasyon ve ödeme işlemleri.
            </li>
            <li>
              <strong>Hukuki yükümlülük:</strong> mali ve yasal saklama zorunlulukları.
            </li>
            <li>
              <strong>Meşru menfaat:</strong> hizmet güvenliği ve iyileştirme.
            </li>
            <li>
              <strong>Açık rıza:</strong> konum verisi, sağlık/ölçüm verileri, ticari bilgilendirme
              (kampanya) mesajları ve yurt dışına aktarım. Açık rıza gerektiren işlemler, onay vermediğiniz
              sürece yapılmaz ve rızanızı dilediğiniz zaman geri alabilirsiniz.
            </li>
          </ul>
        </Section>

        <Section id="konum" title="6. Konum Verisi (Açık Rıza)">
          <p>
            Konum verisi <strong>varsayılan olarak kapalıdır</strong>. Yalnızca uygulamada ilgili onay
            kutusunu işaretlemeniz <em>ve</em> telefonunuzun konum iznini vermeniz hâlinde, QR ile giriş
            sırasında yaklaşık konumunuz kaydedilir. Bu veri:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>yalnızca <strong>kaba</strong> düzeydedir (yaklaşık 1 km; tam adresinizi göstermez),</li>
            <li>olayları değiştirilemez şekilde tutan kayıt defterine <strong>yazılmaz</strong>; ayrı,
              silinebilir bir alanda tutulur,</li>
            <li>onayınızı kaldırdığınızda durur ve talebiniz üzerine silinir,</li>
            <li>reklam veya üçüncü taraf takibi için <strong>kullanılmaz</strong>.</li>
          </ul>
          <p>Konumu paylaşmamanız, girişinizi veya diğer hizmetleri hiçbir şekilde engellemez.</p>
        </Section>

        <Section id="aktarim" title="7. Verilerin Aktarımı ve Yurt Dışı Aktarım">
          <p>
            Verileriniz satılmaz. Yalnızca hizmeti sağlamak için gerekli hizmet sağlayıcılarla (veri
            işleyenler) ve yasal olarak zorunlu hâllerde yetkili kurumlarla paylaşılır:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Google / Firebase (Google Cloud):</strong> barındırma, kimlik doğrulama, veri tabanı,
              dosya depolama, bildirim, uygulama kararlılığı ve analiz. Sunucular Avrupa Birliği
              bölgesindedir.
            </li>
            <li>
              <strong>PAYTR:</strong> ödeme işlemleri (kart verileri yalnızca PAYTR tarafında).
            </li>
            <li>
              <strong>Bildirim ve mesajlaşma sağlayıcıları:</strong> e-posta ve (etkinleştirildiğinde)
              WhatsApp/anlık bildirim gönderimi.
            </li>
          </ul>
          <p>
            Bu sağlayıcıların bir kısmının sunucuları yurt dışında bulunabilir. Yurt dışına aktarım
            gerektiren hâllerde, KVKK’nın öngördüğü koşullara ve açık rızanıza dayanılarak işlem yapılır.
          </p>
        </Section>

        <Section id="saklama" title="8. Saklama Süresi">
          <p>
            Kişisel verileriniz, işleme amacının gerektirdiği ve ilgili mevzuatın öngördüğü süre boyunca
            saklanır; bu süre sona erdiğinde silinir, yok edilir veya anonim hâle getirilir. Üyeliğinizi
            sonlandırmanız hâlinde, yasal saklama zorunluluğu bulunan kayıtlar (örneğin mali kayıtlar) ilgili
            süre boyunca tutulur; diğer verileriniz silme talebiniz doğrultusunda kaldırılır.
          </p>
        </Section>

        <Section id="guvenlik" title="9. Veri Güvenliği">
          <p>
            Verilerinize yetkisiz erişimi önlemek için idari ve teknik tedbirler uygularız: erişim yetki
            kısıtlamaları, güvenli bağlantı (HTTPS), kimlik doğrulama ve rol bazlı yetkilendirme. Kimliğinizi
            açık eden veriler, davranış kayıtlarından ayrı tutulur.
          </p>
        </Section>

        <Section id="analitik" title="10. Analiz ve Benzer Teknolojiler">
          <p>
            Uygulamanın nasıl kullanıldığını anlamak ve hataları gidermek için, kimliğinizi açık etmeyen
            (yalnızca kimlik numaraları ve olay türleri içeren) analiz ve çökme kayıtları kullanabiliriz. Bu
            veriler <strong>reklam veya üçüncü taraf takibi</strong> için kullanılmaz ve satılmaz.
          </p>
        </Section>

        <Section id="haklar" title="11. KVKK Kapsamındaki Haklarınız">
          <p>KVKK m. 11 uyarınca; kişisel verilerinize ilişkin olarak şu haklara sahipsiniz:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>İşlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme</li>
            <li>İşleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme</li>
            <li>Yurt içinde/dışında aktarıldığı üçüncü kişileri bilme</li>
            <li>Eksik/yanlış işlenmişse düzeltilmesini isteme</li>
            <li>Silinmesini veya yok edilmesini isteme (“unutulma hakkı”)</li>
            <li>Düzeltme/silme işlemlerinin aktarıldığı kişilere bildirilmesini isteme</li>
            <li>Otomatik analiz sonucu aleyhinize bir sonuç çıkmasına itiraz etme</li>
            <li>Kanuna aykırı işleme sebebiyle zarara uğrarsanız zararın giderilmesini talep etme</li>
          </ul>
        </Section>

        <Section id="basvuru" title="12. Başvuru">
          <p>
            Haklarınızı kullanmak için taleplerinizi{' '}
            <a href={`mailto:${CONTROLLER.email}`} className="font-medium text-[#7A1F3D] underline">
              {CONTROLLER.email}
            </a>{' '}
            adresine iletebilirsiniz. Başvurunuz en geç 30 gün içinde sonuçlandırılır.
          </p>
        </Section>

        <Section id="cocuk" title="13. Çocukların Gizliliği">
          <p>
            Hizmetler yetişkin üyelere yöneliktir; 18 yaşından küçüklerden bilerek kişisel veri toplamayız.
          </p>
        </Section>

        <Section id="degisiklik" title="14. Değişiklikler">
          <p>
            Bu metni zaman zaman güncelleyebiliriz. Güncel sürüm her zaman bu sayfada yayımlanır; önemli
            değişikliklerde sizi bilgilendiririz. Yürürlük tarihi yukarıda belirtilmiştir.
          </p>
        </Section>
      </div>

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-sm text-neutral-500">
        © 2026 {CONTROLLER.brand}. Tüm hakları saklıdır.
      </footer>
    </main>
  )
}
