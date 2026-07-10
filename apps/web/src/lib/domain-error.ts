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
    case 'session_not_bookable':
      return 'Bu seansa rezervasyon yapılamaz (iptal edilmiş veya başlamış).'
    case 'class_full':
      return `Seans dolu (kapasite: ${error.capacity}).`
    case 'already_booked':
      return 'Bu üye bu seansa zaten kayıtlı.'
    case 'category_mismatch':
      return 'Bu paket bu ders türü için geçerli değil.'
    case 'entitlement_expires_before_session':
      return 'Paketin süresi seans tarihinden önce doluyor.'
    case 'no_bookable_entitlement':
      return 'Bu seans için kullanılabilir bir paket yok.'
    case 'reservation_not_open':
      return 'Bu rezervasyon artık açık değil.'
    default: {
      const exhaustive: never = error
      void exhaustive
      return 'Bir hata oluştu.'
    }
  }
}
