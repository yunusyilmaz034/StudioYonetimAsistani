import { notFound, redirect } from 'next/navigation'

import { requirePageAccess } from '@/server/auth'
import { loadTimesheetPaper } from '@/server/timesheet-query'

import { KagitView } from './kagit-view'

// BASILACAK ÇİZELGE (OR-119 · Faz 6).
//
// Basılan şey KAYITLI bir sürümdür, canlı hesap değil: imzalanan kâğıt ile sistemdeki kayıt sonsuza
// kadar birebir kalmalı. `v` verilmezse haftanın en yeni sürümü; verilirse o sürüm — eski bir kâğıt
// yeniden basılabilir ve üstünde eski olduğu yazar.
export default async function CizelgeYazdirPage({
  searchParams,
}: {
  searchParams: Promise<{ hafta?: string; kisi?: string; v?: string }>
}) {
  const ctx = await requirePageAccess('/mesai')
  if (ctx.actor.type === 'trainer') redirect('/mesai')

  const { hafta, kisi, v } = await searchParams
  if (!hafta || !/^\d{4}-\d{2}-\d{2}$/.test(hafta) || !kisi) notFound()
  const surum = v && /^\d+$/.test(v) ? Number(v) : null
  const kagit = await loadTimesheetPaper(ctx, hafta, kisi, surum)
  if (!kagit) notFound()

  return <KagitView kagit={kagit} />
}
