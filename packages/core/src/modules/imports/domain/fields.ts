import type { FieldSpec } from './headers'
import type { ImportKind } from './types'

// The fields each import kind can fill — the LEFT-HAND side of the mapping screen.
//
// Aliases are folded header names (see `foldHeader`). They are generous on purpose: every one of
// them costs nothing when absent, and each one that hits saves the operator an arrow to draw. They
// are also only ever a SUGGESTION — nothing here can import a column the operator did not confirm.

export const MEMBER_FIELDS: readonly FieldSpec[] = [
  {
    key: 'fullName',
    label: 'Ad Soyad',
    required: true,
    aliases: [
      'adsoyad', 'adsoyadi', 'adisoyadi', 'adsoyisim', 'isimsoyisim', 'isimsoyad', 'advesoyad',
      'uyemusteri', 'uyeadi', 'uye', 'musteri', 'adi', 'isim', 'name', 'fullname', 'namesurname',
    ],
    hint: 'Tek hücrede tam ad. Ad ve soyad ayrı sütunlardaysa ikisini Excel’de birleştirin.',
  },
  {
    key: 'phone',
    label: 'Telefon',
    required: true,
    aliases: ['telefon', 'tel', 'gsm', 'cep', 'ceptelefonu', 'telefonno', 'telefonnumarasi', 'numara', 'phone', 'mobile'],
    hint: '0532…, 532… veya +90532… — hepsi kabul. Okunamayan numara satırı reddeder, tahmin edilmez.',
  },
  { key: 'email', label: 'E-posta', required: false, aliases: ['eposta', 'email', 'mail', 'epostaadresi'] },
  {
    key: 'birthDate',
    label: 'Doğum tarihi',
    required: false,
    aliases: ['dogumtarihi', 'dogum', 'dtarihi', 'birthdate', 'dob'],
    hint: 'GG.AA.YYYY veya YYYY-AA-GG.',
  },
  { key: 'notes', label: 'Not', required: false, aliases: ['not', 'notlar', 'aciklama', 'note', 'notes'] },
]

export const PACKAGE_FIELDS: readonly FieldSpec[] = [
  {
    key: 'fullName',
    label: 'Ad Soyad',
    required: true,
    aliases: MEMBER_FIELDS[0]!.aliases,
    hint: 'Paketin kime ait olduğunu bulmak için. Her paket ayrı satır — iki paketi olan üye iki kez yazılır.',
  },
  {
    key: 'phone',
    label: 'Telefon',
    required: false,
    aliases: MEMBER_FIELDS[1]!.aliases,
    hint: 'Varsa eşleştirme bundan yapılır ve kesindir. Yoksa isimden ÖNERİ çıkarılır, siz onaylarsınız.',
  },
  {
    key: 'productName',
    label: 'Paket',
    required: true,
    aliases: ['paket', 'paketadi', 'uyelik', 'uyelikturu', 'abonelik', 'abonelikadi', 'urun', 'product', 'package'],
    hint: 'Katalogdaki adla birebir eşleşmeli. Eşleşmeyenler önizlemede listelenir — tahmin edilmez.',
  },
  {
    key: 'remainingCredits',
    label: 'Kalan ders',
    required: false,
    aliases: ['kalander', 'kalan', 'kalanders', 'kalanhak', 'kalankredi', 'ders', 'hak', 'kredi', 'remaining'],
    hint: 'KALAN sayı, paketin boyu değil. 8 derslikten 3’ü kullanılmışsa 5 yazın — sistem 5/8 gösterir. Süreli paketlerde boş bırakın.',
  },
  {
    key: 'validUntil',
    label: 'Bitiş tarihi',
    required: true,
    aliases: ['bitistarihi', 'bitis', 'sonkullanma', 'gecerlilik', 'gecerliliktarihi', 'bitimtarihi', 'validuntil', 'enddate'],
    hint: 'Paketin bittiği gün.',
  },
  {
    key: 'validFrom',
    label: 'Başlangıç tarihi',
    required: false,
    aliases: ['baslangictarihi', 'baslangic', 'baslama', 'alimtarihi', 'satistarihi', 'validfrom', 'startdate'],
    hint: 'Boş bırakılırsa bugün kabul edilir.',
  },
  { key: 'note', label: 'Not', required: false, aliases: ['not', 'notlar', 'aciklama', 'note'] },
]

export function fieldsFor(kind: ImportKind): readonly FieldSpec[] {
  return kind === 'members' ? MEMBER_FIELDS : PACKAGE_FIELDS
}
