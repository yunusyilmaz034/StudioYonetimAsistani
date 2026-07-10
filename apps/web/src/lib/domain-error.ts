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
    default: {
      const exhaustive: never = error
      void exhaustive
      return 'Bir hata oluştu.'
    }
  }
}
