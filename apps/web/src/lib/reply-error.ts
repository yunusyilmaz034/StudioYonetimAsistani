// The Turkish sentence for a reply that did not go out (IG-1). One table, used by the Sohbetler screen
// and the dock, so the two can never explain the same refusal differently.
export function replyErrorText(code: string | undefined): string {
  switch (code) {
    case 'window_closed':
      return 'Instagram 24 saatlik cevap penceresi doldu. Müşteri tekrar yazınca cevap verilebilir; telefonu biliniyorsa arayın.'
    case 'instagram_not_configured':
      return 'Instagram bağlantısı panelde tanımlı değil — gönderilemedi.'
    case 'whatsapp_not_configured':
      return 'WhatsApp bağlantısı panelde tanımlı değil — gönderilemedi.'
    case 'not_found':
      return 'Sohbet bulunamadı — sayfayı yenileyin.'
    default:
      return 'Gönderilemedi (24 saat penceresi dışı olabilir).'
  }
}
