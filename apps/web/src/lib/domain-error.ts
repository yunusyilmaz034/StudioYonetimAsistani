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
    case 'correction_credit_unsupported':
      return 'Bu düzeltme bir kredinin yeniden düşülmesini gerektiriyor; şu an desteklenmiyor.'
    default: {
      const exhaustive: never = error
      void exhaustive
      return 'Bir hata oluştu.'
    }
  }
}
