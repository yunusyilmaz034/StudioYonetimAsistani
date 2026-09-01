'use server'

import { z } from 'zod'

import { consumeStaffInvite } from '../staff-invite'

// HERKESE AÇIK, zorunlu olarak: davet edilen kişinin henüz şifresi yok, yani doğrulanacak bir oturum
// da yok. Jetonun kendisi kimliktir — bu yüzden 32 baytlık CSPRNG, yalnızca özeti saklanıyor, tek
// kullanımlık ve 7 gün ömürlü (bkz. `server/staff-invite.ts`).
//
// Bu dosyada yetki kontrolü YOKTUR ve olmamalıdır; onun yerine `consumeStaffInvite` her şeyi tek bir
// koşullu işlemde doğrular: davet var mı, tüketilmiş mi, süresi dolmuş mu, personel hâlâ aktif mi.
export async function setStaffPasswordAction(input: unknown) {
  const p = z
    .object({
      studioId: z.string().min(1).max(64),
      token: z.string().min(20).max(200),
      password: z.string().min(8).max(200),
    })
    .parse(input)
  return consumeStaffInvite(p.studioId, p.token, p.password)
}
