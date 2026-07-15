'use client'

import { useState } from 'react'

import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { NotificationRow, TemplateRow } from '@/server/actions/notifications'

import { BulkSend } from './bulk-send'
import { NotificationCenter } from './notification-center'
import { TemplateManager } from './template-manager'

// One desk area, three jobs: read what happened (the centre), edit what we say (templates), and send
// a message on purpose (bulk). Editing copy and bulk sending are the owner's alone; reception reads.
export function NotificationsScreen({
  initial,
  templates,
  canManage,
}: {
  initial: readonly NotificationRow[]
  templates: readonly TemplateRow[]
  canManage: boolean
}) {
  const [tab, setTab] = useState('center')

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Bildirim Merkezi"
        description="Kime, hangi kanaldan, ne zaman ulaştık — ve neyi bilerek göndermedik."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="center" className="min-h-9 flex-1">
            Bildirimler
          </TabsTrigger>
          <TabsTrigger value="templates" className="min-h-9 flex-1">
            Şablonlar
          </TabsTrigger>
          {canManage ? (
            <TabsTrigger value="bulk" className="min-h-9 flex-1">
              Toplu Gönderim
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="center">
          <NotificationCenter initial={initial} canManage={canManage} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplateManager initial={templates} canManage={canManage} />
        </TabsContent>
        {canManage ? (
          <TabsContent value="bulk">
            <BulkSend templates={templates} />
          </TabsContent>
        ) : null}
      </Tabs>
    </main>
  )
}
