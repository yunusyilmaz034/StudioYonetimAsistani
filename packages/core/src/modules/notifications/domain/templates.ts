import type { NotificationTemplate } from './types'

// ── THE TEMPLATE CATALOGUE (v1.25). ─────────────────────────────────────────────────────────
//
// Turkish sentences, `{{param}}` placeholders, versioned. **A technical event name never appears in
// a template** (owner rule 7) — the same discipline as the v1.22 presenter, for the same reason: the
// person reading this is a member with a phone in her hand, not a developer with a log.
//
// The version is stamped on the intent, so "what exactly did you send me?" has an exact answer years
// later — the same reason `productSnapshot` and `SaleLine` exist.
//
// The catalogue is DATA (AD-41). This file is the seed; a studio may edit its own copies without a
// deploy. Nothing in the code knows what a message says.

export const TEMPLATES: Readonly<Record<string, NotificationTemplate>> = {
  booking_confirmed: {
    id: 'booking_confirmed',
    version: 1,
    name: 'Rezervasyon oluşturuldu',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'sessionName', 'sessionTime'],
    subject: 'Rezervasyonunuz alındı',
    body: 'Merhaba {{memberName}}, {{sessionName}} dersiniz için {{sessionTime}} tarihinde yeriniz ayrıldı. Görüşmek üzere!',
  },
  booking_cancelled: {
    id: 'booking_cancelled',
    version: 1,
    name: 'Rezervasyon iptal edildi',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'sessionName', 'sessionTime'],
    subject: 'Rezervasyonunuz iptal edildi',
    body: 'Merhaba {{memberName}}, {{sessionTime}} tarihindeki {{sessionName}} dersi rezervasyonunuz iptal edildi.',
  },
  booking_moved: {
    id: 'booking_moved',
    version: 1,
    name: 'Rezervasyon taşındı',
    category: 'operational',
    priority: 'high',
    requiredParams: ['memberName', 'fromTime', 'toTime'],
    subject: 'Dersiniz başka bir saate taşındı',
    body: 'Merhaba {{memberName}}, dersiniz {{fromTime}} tarihinden {{toTime}} tarihine taşındı.',
  },
  // URGENT: a class cancelled for tomorrow morning cannot wait until 08:00 (owner, decision 4).
  session_cancelled: {
    id: 'session_cancelled',
    version: 1,
    name: 'Ders iptal edildi',
    category: 'operational',
    priority: 'urgent',
    requiredParams: ['memberName', 'sessionName', 'sessionTime'],
    subject: 'Dersiniz iptal edildi',
    body: 'Merhaba {{memberName}}, {{sessionTime}} tarihindeki {{sessionName}} dersi iptal edildi. Kredileriniz iade edildi.',
  },
  waitlist_promoted: {
    id: 'waitlist_promoted',
    version: 1,
    name: 'Bekleme listesinden yer açıldı',
    category: 'operational',
    priority: 'high',
    requiredParams: ['memberName', 'sessionName', 'sessionTime'],
    subject: 'Bekleme listesinden yer açıldı',
    body: 'Merhaba {{memberName}}, {{sessionTime}} tarihindeki {{sessionName}} dersinde yer açıldı ve rezervasyonunuz oluşturuldu.',
  },
  // ── DERS HATIRLATMALARI. A pilates class has a fixed time, so its reminder is AUTOMATIC (a scheduled
  //    sweep emits `class_reminder.due` ~1h before). `high` so a class early in the morning is not held
  //    behind quiet hours until it is already too late. Fitness is serbest-giriş — no time, no automatic
  //    reminder; its template is the same shape but sent MANUALLY from the bulk/manual send screen.
  pilates_hatirlatma: {
    id: 'pilates_hatirlatma',
    version: 1,
    name: 'Pilates ders hatırlatması',
    category: 'operational',
    priority: 'high',
    requiredParams: ['memberName', 'sessionName', 'sessionTime'],
    subject: 'Ders hatırlatması',
    body: 'Merhaba {{memberName}} 🌸 Bugün saat {{sessionTime}} {{sessionName}} dersini hatırlatırız. Tam boy havlunu ve kaymaz çorabını yanına almayı unutma. Görüşmek üzere!',
  },
  fitness_hatirlatma: {
    id: 'fitness_hatirlatma',
    version: 1,
    name: 'Fitness hatırlatması',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName'],
    subject: 'Fitness hatırlatması',
    body: 'Merhaba {{memberName}} 🌸 Fitness antrenmanına gelirken tam boy havlunu ve spor ayakkabını yanına almayı unutma. Görüşmek üzere!',
  },
  // ONE message per member per operation (Doc 28 §4) — a closure that cancels twelve of her classes
  // must not send twelve messages. The count is a parameter, not twelve deliveries.
  closure_applied: {
    id: 'closure_applied',
    version: 1,
    name: 'Tatil / kapanış',
    category: 'operational',
    priority: 'urgent',
    requiredParams: ['memberName', 'reason', 'sessionCount'],
    subject: 'Stüdyo kapanışı hakkında',
    body: '{{memberName}}, "{{reason}}" nedeniyle {{sessionCount}} dersiniz iptal edildi. Kredileriniz iade edildi, üyeliğiniz uzatıldı.',
  },
  package_created: {
    id: 'package_created',
    version: 1,
    name: 'Paket tanımlandı',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'productName'],
    subject: 'Yeni üyeliğiniz tanımlandı',
    body: 'Merhaba {{memberName}}, {{productName}} üyeliğiniz tanımlandı. İyi antrenmanlar!',
  },
  package_expiring: {
    id: 'package_expiring',
    version: 1,
    name: 'Paket süresi yaklaşıyor',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'productName', 'daysLeft'],
    subject: 'Üyeliğinizin süresi doluyor',
    body: 'Merhaba {{memberName}}, {{productName}} üyeliğinizin bitmesine {{daysLeft}} gün kaldı. Yenilemek isterseniz bize ulaşabilirsiniz.',
  },
  package_expired: {
    id: 'package_expired',
    version: 1,
    name: 'Paket süresi doldu',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'productName'],
    subject: 'Üyeliğinizin süresi doldu',
    body: 'Merhaba {{memberName}}, {{productName}} üyeliğinizin süresi doldu. Yenilemek için bize ulaşabilirsiniz.',
  },
  session_rescheduled: {
    id: 'session_rescheduled',
    version: 1,
    name: 'Ders saati değişti',
    category: 'operational',
    priority: 'high',
    requiredParams: ['memberName', 'sessionName', 'fromTime', 'toTime'],
    subject: 'Dersinizin saati değişti',
    body: 'Merhaba {{memberName}}, {{sessionName}} dersiniz {{fromTime}} yerine {{toTime}} saatine alındı.',
  },
  payment_failed: {
    id: 'payment_failed',
    version: 1,
    name: 'Ödeme başarısız',
    category: 'operational',
    priority: 'high',
    requiredParams: ['memberName'],
    subject: 'Ödemeniz tamamlanamadı',
    body: 'Merhaba {{memberName}}, ödemeniz tamamlanamadı. Tekrar denemek için bizimle iletişime geçebilirsiniz.',
  },
  refund_completed: {
    id: 'refund_completed',
    version: 1,
    name: 'İade tamamlandı',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'amount'],
    subject: 'İadeniz işleme alındı',
    body: 'Merhaba {{memberName}}, {{amount}} tutarındaki iadeniz işleme alındı.',
  },
  credits_low: {
    id: 'credits_low',
    version: 1,
    name: 'Kredi azalıyor',
    category: 'operational',
    priority: 'low',
    requiredParams: ['memberName', 'remaining'],
    subject: 'Ders hakkınız azalıyor',
    body: 'Merhaba {{memberName}}, {{remaining}} ders hakkınız kaldı. Yeni paket için istediğiniz zaman bize ulaşabilirsiniz.',
  },
  credits_exhausted: {
    id: 'credits_exhausted',
    version: 1,
    name: 'Kredi bitti',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName'],
    subject: 'Ders hakkınız bitti',
    body: 'Merhaba {{memberName}}, paketinizdeki ders hakları doldu. Dilerseniz yeni bir paketle devam edebilirsiniz.',
  },
  payment_received: {
    id: 'payment_received',
    version: 1,
    name: 'Ödeme alındı',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'amount'],
    subject: 'Ödemeniz alındı',
    body: 'Merhaba {{memberName}}, {{amount}} tutarındaki ödemeniz alındı. Teşekkür ederiz.',
  },
  balance_reminder: {
    id: 'balance_reminder',
    version: 1,
    name: 'Açık bakiye hatırlatması',
    category: 'operational',
    priority: 'low',
    requiredParams: ['memberName', 'amount'],
    subject: 'Açık bakiye hatırlatması',
    body: 'Merhaba {{memberName}}, {{amount}} tutarında açık bakiyeniz bulunuyor.',
  },
  instalment_due: {
    id: 'instalment_due',
    version: 1,
    name: 'Taksit tarihi yaklaşıyor',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'amount', 'dueDate'],
    subject: 'Taksit ödemeniz yaklaşıyor',
    body: 'Merhaba {{memberName}}, {{dueDate}} tarihinde {{amount}} tutarında taksit ödemeniz bulunuyor.',
  },
  // Sent BY THE CODE PATH THAT HOLDS THE RAW TOKEN — reception's invite panel, or the online-sale
  // callback (blok 2c). Never off `member.invited`: the token is deliberately absent from that event
  // (a secret in an append-only log is unrecoverable), so an event-driven send could only ever carry
  // a link that opens nothing.
  // TWO links, deliberately. `inviteLink` is single-use — it is how she sets a password, and it dies
  // the moment she does (or the moment a newer invite supersedes it). Without `loginLink` she would
  // have nowhere to go on her second visit except back to a dead link.
  portal_invite: {
    id: 'portal_invite',
    version: 3,
    name: 'Üyelik daveti',
    category: 'operational',
    priority: 'high',
    requiredParams: ['memberName', 'inviteLink', 'loginLink'],
    subject: 'Üyeliğiniz hazır',
    body: 'Merhaba {{memberName}} 🌸 Üyeliğiniz hazır! Şifrenizi belirleyip giriş yapmak için: {{inviteLink}} — sonraki girişleriniz için adres: {{loginLink}}',
  },
  // The alarm the OWNER receives, not the member. `urgent` on purpose: quiet hours must not hold it
  // until 08:00 — a receptionist arriving to a system that broke at 23:00 needs to know at 23:00,
  // and the whole point of a health check is that nobody is watching the screen when it fires.
  // A person on WhatsApp who has just said she is ready to buy (2026-07-27, owner).
  //
  // `urgent` is not drama: this notification has a shelf life measured in minutes. She is holding her
  // phone right now; tomorrow she is a cold call, which is exactly the complaint that produced this
  // feature. Quiet hours are the wrong instinct here — 21:40 is when people message a gym.
  //
  // No package, no price, no promise in the body. Whoever picks it up opens the conversation and
  // talks to her; the alert's only job is to get a human there while she is still in it.
  lead_handoff: {
    id: 'lead_handoff',
    version: 1,
    name: 'Satışa hazır kişi (resepsiyon/sahip)',
    category: 'operational',
    priority: 'urgent',
    requiredParams: ['leadName', 'leadPhone', 'lastMessage'],
    subject: '🔥 {{leadName}} kayıt olmak istiyor',
    body: '🔥 SATIŞA HAZIR\n{{leadName}} · {{leadPhone}}\n\nSon yazdığı:\n"{{lastMessage}}"\n\nAI bilgiyi verdi ve kişiyi size bıraktı; hâlâ hatta. Panelden WhatsApp kutusunu açıp AYNI sohbete yazın — beklerse yarın soğuk bir arama olur.',
  },
  system_alert: {
    id: 'system_alert',
    version: 1,
    name: 'Sistem uyarısı (sahip)',
    category: 'operational',
    priority: 'urgent',
    requiredParams: ['alertTitle', 'alertDetail'],
    subject: 'Sistem uyarısı: {{alertTitle}}',
    body: '⚠️ {{alertTitle}}\n{{alertDetail}}\n\nPanelde İşlemler → Sistem Uyarıları ekranından ne yapmanız gerektiğini görebilirsiniz.',
  },
  // The weekly "still here" message. Its whole value is in ARRIVING: the owner is told, in the text
  // itself, that a missing heartbeat means something is wrong — which is the only way to notice the
  // one failure a self-hosted watchdog cannot report, its own suspension.
  system_heartbeat: {
    id: 'system_heartbeat',
    version: 1,
    name: 'Haftalık sistem kontrolü (sahip)',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['summary'],
    subject: 'Sistem kontrolü: her şey yolunda',
    body: '✅ Haftalık sistem kontrolü\n{{summary}}\n\nBu mesaj her Pazartesi gelir. GELMEZSE bir sorun var demektir — lütfen bize haber verin.',
  },
  wallet_topup: {
    id: 'wallet_topup',
    version: 1,
    name: 'Cüzdan yüklemesi', // v1.27 will emit it; the template exists so the seam is real
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName', 'amount', 'balance'],
    subject: 'Cüzdanınıza bakiye yüklendi',
    body: 'Merhaba {{memberName}}, cüzdanınıza {{amount}} yüklendi. Güncel bakiyeniz: {{balance}}.',
  },

  // ── Plus Phase 7 (Training & Progress). The programme and the reply live behind the member portal;
  //    the message says only THAT there is something new, never its content (the event carries no PII). ──
  program_published: {
    id: 'program_published',
    version: 1,
    name: 'Antrenman programı hazır',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName'],
    subject: 'Antrenman programınız hazır',
    body: 'Merhaba {{memberName}}, antrenman programınız hazır. Üye portalınızdan görüntüleyebilirsiniz.',
  },
  feedback_answered: {
    id: 'feedback_answered',
    version: 1,
    name: 'Geri bildirime yanıt verildi',
    category: 'operational',
    priority: 'normal',
    requiredParams: ['memberName'],
    subject: 'Geri bildiriminize yanıt verildi',
    body: 'Merhaba {{memberName}}, antrenörünüz geri bildiriminize yanıt verdi. Üye portalınızdan görebilirsiniz.',
  },
  // PF-32 — a member left feedback on a specific movement. The owner/trainer needs to know NOW, and
  // which member, which programme, which exercise, and why (the reason). Goes to the owner in-app.
  feedback_left: {
    id: 'feedback_left',
    version: 1,
    name: 'Antrenman geri bildirimi (owner)',
    category: 'operational',
    priority: 'high',
    requiredParams: ['memberName', 'programName', 'exerciseName', 'reason'],
    subject: 'Yeni antrenman geri bildirimi',
    body: '{{memberName}}, "{{programName}}" programındaki {{exerciseName}} hareketi için geri bildirim bıraktı: {{reason}}. Üye portalından yanıtlayabilirsiniz.',
  },

  // ── STAFF ALERTS (owner, decision 6). The most important line on the owner's list: today NOTHING
  //    tells her when an operation fails. These are half of this milestone, not an afterthought.
  alert_cash_discrepancy: {
    id: 'alert_cash_discrepancy',
    version: 1,
    name: 'Kasa farkı (owner)',
    category: 'operational',
    priority: 'urgent',
    requiredParams: ['drawerName', 'discrepancy'],
    subject: 'Kasa farkı oluştu',
    body: '{{drawerName}} kapanışında {{discrepancy}} fark kaydedildi. Denetim Kaydı’ndan inceleyebilirsiniz.',
  },
  alert_operation_failed: {
    id: 'alert_operation_failed',
    version: 1,
    name: 'Toplu işlem hatası (owner)',
    category: 'operational',
    priority: 'urgent',
    requiredParams: ['detail'],
    subject: 'Bir toplu işlem tamamlanamadı',
    body: 'Bir toplu işlem beklendiği gibi tamamlanamadı: {{detail}}',
  },
  alert_system_error: {
    id: 'alert_system_error',
    version: 1,
    name: 'Sistem hatası (owner)',
    category: 'operational',
    priority: 'urgent',
    requiredParams: ['detail'],
    subject: 'Sistem hatası',
    body: 'Sistemde bir hata oluştu: {{detail}}',
  },
  alert_delivery_failed: {
    id: 'alert_delivery_failed',
    version: 1,
    name: 'Bildirim iletilemedi (resepsiyon)',
    category: 'operational',
    priority: 'high',
    requiredParams: ['memberName', 'channel', 'reason'],
    subject: 'Bir üyeye bildirim iletilemedi',
    body: '{{memberName}} adlı üyeye {{channel}} ile bildirim iletilemedi ({{reason}}). Telefonla ulaşmanız gerekebilir.',
  },
  // ── "Stüdyodan" engagement broadcast (v1.27) — a PASSTHROUGH: the owner-written subject/body ride in
  //    as params, so the whole notify()/inbox/preference pipeline is reused for motivation, birthday and
  //    campaign content. category 'marketing' ⇒ push/WhatsApp respect consent; in-app always lands. ──
  engagement_broadcast: {
    id: 'engagement_broadcast',
    version: 1,
    name: 'Stüdyodan mesaj',
    category: 'marketing',
    priority: 'low',
    requiredParams: ['memberName', 'subject', 'body'],
    subject: '{{subject}}',
    body: '{{body}}',
  },
}
