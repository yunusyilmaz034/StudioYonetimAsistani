import type { DomainError } from '@studio/core'

// Every DomainError code maps to exactly one Turkish message, in one file (Doc 6
// §7). The domain layer never contains a Turkish string.
export function domainErrorMessage(error: DomainError): string {
  switch (error.code) {
    case 'invalid_phone':
      return 'Geçerli bir cep telefonu girin (örn. 0532 123 45 67).'
    case 'phone_already_registered':
      return 'Bu telefon numarası zaten kayıtlı bir üyeye ait.'
    case 'reason_required':
      return 'Bir sebep girin.'
    case 'note_required':
      return 'Bir açıklama girin.'
    case 'session_capacity_exceeds_room':
      return `Kapasite salon kapasitesini (${error.roomCapacity}) aşamaz.`
    case 'branch_mismatch':
      return 'Seçilen salon bu şubeye ait değil.'
    case 'invalid_time_range':
      return 'Bitiş saati başlangıç saatinden sonra olmalı.'
    case 'session_not_editable':
      return 'Başlamış, tamamlanmış veya iptal edilmiş seans düzenlenemez.'
    case 'capacity_below_booked':
      return `Kapasite mevcut rezervasyon sayısının (${error.bookedCount}) altına inemez.`
    case 'room_not_active':
      return 'Seçilen salon aktif değil.'
    case 'insufficient_credits':
      return `Yeterli kredi yok (kalan: ${error.available}).`
    case 'operation_already_applied':
      return 'Bu işlem zaten uygulandı. Aynı işlem ikinci kez uygulanamaz.'
    case 'operation_not_applicable':
      return 'Bu işlem uygulanabilir durumda değil.'
    case 'entitlement_frozen':
      return 'Bu paket dondurulmuş. Dondurulmuş paketler toplu işlemlere dahil edilmez; ayrıca ele alınmalıdır.'
    case 'entitlement_not_active':
      return 'Bu paket aktif değil.'
    case 'not_a_credit_entitlement':
      return 'Bu paket kredi bazlı değil.'
    case 'no_held_credit':
      return 'Bu rezervasyon için tutulmuş bir kredi yok.'
    case 'invalid_adjustment':
      return 'Geçerli bir kredi değişimi girin (sıfır olamaz).'
    case 'held_credits_block_expiry':
      return 'Tutulan kredisi olan paket süre sonuna erdirilemez.'
    case 'invalid_amount':
      return 'Geçerli bir tutar girin.'
    case 'entitlement_not_cancelled':
      return 'Yalnızca iptal edilmiş bir abonelik yeniden aktifleştirilebilir.'
    case 'branch_not_open':
      return 'Şube kapalı. Önce şubeyi açın.'
    case 'session_not_bookable':
      return 'Bu seansa rezervasyon yapılamaz (iptal edilmiş veya başlamış).'
    case 'class_full':
      return `Seans dolu (kapasite: ${error.capacity}).`
    case 'already_booked':
      return 'Bu üye bu seansa zaten kayıtlı.'
    case 'category_mismatch':
      return 'Bu paket bu ders türü için geçerli değil.'
    case 'service_not_covered':
      return 'Bu paket bu dersi kapsamıyor. Üyenin bu dersi kapsayan bir paketi olmalı.'
    case 'product_requires_service':
      return 'Paketin kapsadığı en az bir ders seçilmelidir.'
    case 'session_not_assigned_to_member':
      return 'Bu PT seansı başka bir üyeye ayrılmış. Yalnızca ayrıldığı üye rezerve edilebilir.'
    case 'pt_capacity_exceeded':
      return `PT seansı en fazla ${error.maxCapacity} kişilik olabilir (birebir veya partner PT). Daha kalabalık bir ders grup dersi olarak açılmalıdır.`
    case 'member_not_eligible_for_service':
      return 'Bu üyenin bu PT hizmetini kapsayan aktif bir paketi yok. Önce uygun bir paket tanımlayın.'
    case 'assignment_requires_private_session':
      return 'Yalnızca PT (özel) seansları bir üyeye ayrılabilir.'
    case 'session_has_reservations':
      return 'Bu seansta rezervasyon var. Önce rezervasyonu iptal edin, sonra üyeyi değiştirin.'
    case 'invite_invalid':
      return 'Bu davet artık geçerli değil. Lütfen stüdyodan yeni bir bağlantı isteyin.'
    case 'member_not_active':
      return 'Bu üye aktif değil. Önce üyeliği aktifleştirin.'
    case 'qr_invalid':
      return 'QR kod geçersiz. Üyeden kodu yenilemesini isteyin veya manuel arama kullanın.'
    case 'qr_expired':
      return 'QR kodun süresi doldu. Üyeden ekranı yenilemesini isteyin.'
    case 'qr_used':
      return 'Bu QR kod zaten kullanıldı. Üyeden yeni kod isteyin.'
    case 'member_self_booking_disabled':
      return 'Bu ders için online rezervasyon kapalı. Lütfen stüdyoyla iletişime geçin.'
    case 'weak_password':
      return 'Şifre en az 8 karakter olmalıdır.'
    case 'cancellation_window_unresolved':
      return 'İptal süresi belirlenemedi. Stüdyo ayarlarından varsayılan iptal süresini tanımlayın.'
    case 'entitlement_expires_before_session':
      return 'Paketin süresi seans tarihinden önce doluyor.'
    case 'no_bookable_entitlement':
      return 'Bu seans için kullanılabilir bir paket yok.'
    case 'reservation_not_open':
      return 'Bu rezervasyon artık açık değil.'
    case 'auto_resolve_too_early':
      return 'Seansın bekleme süresi henüz dolmadı; otomatik sonuçlandırılamaz.'
    case 'reservation_not_resolved':
      return 'Yalnızca sonuçlanmış bir rezervasyon düzeltilebilir.'
    case 'outside_cancellation_window':
      return 'Ücretsiz değiştirme süresi doldu. Bu seansı yalnızca stüdyo bir gerekçeyle taşıyabilir.'
    case 'waitlist_not_open':
      return 'Bu seans için bekleme listesi açık değil.'
    case 'already_waitlisted':
      return 'Bu seansın bekleme listesinde zaten yer alıyorsunuz.'
    // ── finance (v1.24) ──
    case 'discount_exceeds_ceiling':
      return `İndirim, stüdyo limitinin (%${error.ceilingPercent}) üzerinde. Bu indirimi yalnızca yönetici uygulayabilir.`
    case 'drawer_required':
      return 'Nakit ve POS tahsilatı için bir kasa seçilmelidir.'
    case 'drawer_not_open':
      return 'Kasa kapalı. Önce kasayı açın.'
    case 'drawer_already_open':
      return 'Bu kasa zaten açık.'
    case 'giftcard_not_found':
      return 'Hediye kartı bulunamadı.'
    case 'giftcard_not_active':
      return 'Hediye kartı kullanıma kapalı.'
    case 'giftcard_insufficient':
      return `Hediye kartında yeterli bakiye yok (kalan: ${(error.remaining / 100).toLocaleString('tr-TR')} ₺).`
    case 'allocation_exceeds_payment':
      return 'Bu ödemeden kalan tutardan fazlası mahsup edilemez.'
    case 'allocation_exceeds_sale':
      return 'Satışın kalan borcundan fazlası mahsup edilemez. Fazla tutar üyenin alacağı olarak kalır.'
    case 'plan_total_mismatch':
      return 'Taksitlerin toplamı satışın kalan borcuna eşit olmalı.'
    case 'coupon_invalid':
      return 'Kupon geçersiz veya süresi dolmuş.'
    case 'lead_not_open':
      return 'Bu aday kaydı artık açık değil.'
    // ── notifications (v1.25) ──
    case 'template_not_found':
      return 'Bildirim şablonu bulunamadı.'
    case 'template_params_missing':
      return 'Bildirim metni oluşturulamadı: eksik bilgi var. Boş alanlı mesaj gönderilmez.'
    case 'daily_limit_reached':
      return `Günlük bildirim limiti (${error.limit}) doldu. Yeni bildirim oluşturulmuyor.`
    case 'notification_not_found':
      return 'Bildirim kaydı bulunamadı.'
    case 'correction_credit_unsupported':
      return 'Bu düzeltme bir kredinin yeniden düşülmesini gerektiriyor; şu an desteklenmiyor.'
    case 'erasure_requires_platform_admin':
      return 'Üye kaydını anonimleştirme yetkisi yalnızca platform yöneticisindedir.'
    case 'staff_admin_required':
      return 'Personel yetkilerini yalnızca stüdyo sahibi düzenleyebilir.'
    case 'name_required':
      return 'Ad soyad zorunludur.'
    case 'cannot_deactivate_self':
      return 'Kendi hesabınızı pasife alamazsınız.'
    case 'last_owner_required':
      return 'Stüdyoda en az bir aktif sahip bulunmalıdır. Önce başka bir sahip yetkilendirin.'
    case 'freeze_not_allowed':
      return 'Bu pakette dondurma hakkı yok.'
    case 'freeze_budget_exhausted':
      return 'Dondurma hakkı doldu.'
    case 'freeze_blocked_by_reservation':
      // The owner's own words (2026-07-13). Nothing is changed for her behind her back.
      return 'Önce mevcut rezervasyonlarınızı iptal edin, ardından üyeliğinizi dondurabilirsiniz.'
    case 'entitlement_already_frozen':
      return 'Bu paket zaten dondurulmuş.'
    case 'entitlement_not_frozen':
      return 'Bu paket dondurulmuş değil.'
    // AG-1 — the studio's own opening hours. It refuses, and it says WHICH hours it refused against:
    // "kapalı saatte olamaz" leaves reception guessing what the hours are.
    case 'studio_closed_on_day':
      return 'Stüdyo o gün kapalı. Çalışma saatlerini Ayarlar’dan değiştirebilirsiniz.'
    case 'outside_working_hours':
      return `Bu saat stüdyonun çalışma saatleri dışında (${error.open}–${error.close}). Dersin tamamı bu aralığa sığmalı.`
    // ── Package Rules 2.0 (Plus Phase 3) — each says WHICH rule refused, never a bare failure. ──
    case 'invalid_weekday':
      return 'Geçersiz gün seçimi.'
    case 'invalid_hour_range':
      return 'Geçersiz saat aralığı. Bitiş, başlangıçtan sonra olmalı ve aralık gün içinde kalmalı.'
    case 'invalid_allowance':
      return 'Geçersiz iptal hakkı değeri.'
    case 'invalid_limit':
      return 'Geçersiz limit değeri.'
    case 'invalid_trainer':
      return 'Eğitmen kısıtı için en az bir eğitmen seçilmelidir.'
    case 'invalid_validity_range':
      return 'Geçersiz geçerlilik aralığı. Bitiş tarihi başlangıçtan sonra olmalı.'
    case 'template_inactive':
      return 'Bu şablon pasif durumda; gönderim yapılmadı.'
    // ── Plus Phase 6 (Commerce & Payments) ──
    case 'payment_ref_mismatch':
      return 'Ödeme referansı eşleşmiyor.'
    case 'payment_not_pending':
      return 'Bu ödeme artık beklemede değil.'
    case 'payment_not_refundable':
      return 'Bu ödeme iade edilebilir durumda değil.'
    case 'refund_exceeds_paid':
      return 'İade tutarı ödenen tutardan fazla olamaz.'
    case 'payment_provider_not_configured':
      return 'Ödeme sağlayıcısı yapılandırılmamış. Ayarlar › Entegrasyonlar’dan PAYTR’ı bağlayın.'
    case 'retail_out_of_stock':
      return `Yeterli stok yok (mevcut: ${error.available}).`
    // ── Plus Phase 7 (Training & Progress) ──
    case 'program_archived':
      return 'Arşivlenmiş program düzenlenemez. Yeni bir program oluşturun.'
    case 'program_empty':
      return 'Programda en az bir gün ve hareket olmalı.'
    case 'program_version_conflict':
      return 'Program versiyonu çakıştı. Sayfayı yenileyip tekrar deneyin.'
    case 'template_name_required':
      return 'Şablon adı gerekli.'
    case 'template_empty':
      return 'Şablonda en az bir gün ve her günde en az bir hareket olmalı.'
    case 'template_not_found_pt':
      return 'Program şablonu bulunamadı.'
    // ── Plus Phase 9 (Trainer Payroll & Commission) ──
    case 'invalid_compensation_rate':
      return 'Geçersiz ücret. Seçilen modelin gerektirdiği ücreti girin (negatif olamaz).'
    case 'invalid_commission_percent':
      return 'Komisyon yüzdesi 0 ile 100 arasında olmalı.'
    case 'compensation_plan_missing':
      return 'Bu eğitmen için önce bir ücret planı tanımlayın.'
    case 'payroll_already_finalized':
      return 'Bu dönem zaten kesinleştirilmiş. Kesinleşen bir hakediş yeniden hesaplanmaz.'
    case 'statement_not_finalized':
      return 'Önce hakedişi kesinleştirin, sonra ödendi olarak işaretleyin.'
    case 'statement_already_paid':
      return 'Bu hakediş zaten ödendi olarak işaretlenmiş.'
    case 'cancellation_allowance_exhausted':
      return `İptal hakkı doldu (${error.allowance} hakkın tamamı kullanıldı). Bu rezervasyon iptal edilemez; üye derse katılabilir.`
    case 'day_not_allowed':
      return 'Bu üye bu gün için rezervasyon yapamıyor (Kısıtlı Üyelik: izin verilen günler).'
    case 'time_not_allowed':
      return 'Bu üye bu saat için rezervasyon yapamıyor (Kısıtlı Üyelik: izin verilen saatler).'
    case 'trainer_not_allowed':
      return 'Bu üye bu eğitmenden rezervasyon yapamıyor (Kısıtlı Üyelik: izin verilen eğitmenler).'
    case 'daily_reservation_limit_reached':
      return `Günlük rezervasyon limitine ulaşıldı (en fazla ${error.limit}).`
    case 'active_reservation_limit_reached':
      return `Aktif rezervasyon limitine ulaşıldı (en fazla ${error.limit}).`
    default: {
      const exhaustive: never = error
      void exhaustive
      return 'Bir hata oluştu.'
    }
  }
}
