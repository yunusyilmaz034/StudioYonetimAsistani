'use server'

import { cookies } from 'next/headers'
import { z } from 'zod'

import { requireTenantContext } from '../auth'

// ── DEMO MODU — açma/kapama (owner, 2026-08-08) ──────────────────────────────────────────────
//
// Yalnızca bir ÇEREZ yazar. Veritabanına, olay kaydına ya da stüdyo ayarlarına hiçbir şey yazılmaz:
// bu bir görüntüleme tercihidir, bir işletme kararı değil. Sahibi açtığında resepsiyonun ekranı
// değişmez, çünkü çerez o kişinin tarayıcısında durur.
//
// Sahip + platform_admin'e ait: demoyu gösteren kişi odur, ve maskelenmiş bir panelde çalışmak
// resepsiyonun işini zorlaştırır (aradığı üyeyi bulamaz).
const OWNER = ['owner', 'platform_admin'] as const
const COOKIE = 'demo_mask'

export async function setDemoModeAction(input: unknown) {
  const p = z.object({ on: z.boolean() }).parse(input)
  await requireTenantContext(OWNER)
  const jar = await cookies()
  if (p.on) {
    jar.set(COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      // Sekiz saat: bir demo ya da ekran görüntüsü seansı bundan uzun sürmez, ve unutulan bir maske
      // resepsiyonun ertesi gün üye arayamaması demektir.
      maxAge: 8 * 60 * 60,
    })
  } else {
    jar.delete(COOKIE)
  }
  return { ok: true as const, value: { on: p.on } }
}

export async function getDemoModeAction(): Promise<boolean> {
  await requireTenantContext(OWNER)
  return (await cookies()).get(COOKIE)?.value === '1'
}
