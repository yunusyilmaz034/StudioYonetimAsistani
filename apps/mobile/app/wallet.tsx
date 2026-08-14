import { useState } from 'react'
import { ActivityIndicator, Alert, RefreshControl, View } from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import type { RetailItem, WalletTxn } from '@studio/core/client'
import { api } from '@/lib/api'
import { track } from '@/lib/analytics'
import { formatKurus } from '@/lib/format'
import { useFetch } from '@/lib/useFetch'
import { FadeInUp } from '@/components/motion'
import { Body, Hero, Loading, Screen } from '@/components/ui'
import { EmptyState, PremiumCard, SectionHeader, StatusChip, Txt } from '@/components/kit'
import { radius, space, typo as t, usePalette } from '@/theme'

const TOPUPS = [10000, 25000, 50000] // 100 / 250 / 500 ₺
const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Wallet() {
  const p = usePalette()
  const wallet = useFetch(api.walletBalance)
  const store = useFetch(api.store)
  const [busy, setBusy] = useState<string | null>(null)
  const balance = wallet.data?.balance ?? 0

  if (wallet.loading && !wallet.data) return <Loading />

  async function topup(amount: number) {
    setBusy(`top-${amount}`)
    try {
      const res = await api.walletTopup(amount)
      if (res.ok) {
        track('wallet_topup', { amount_kurus: amount })
        track('payment_started', { method: 'wallet_topup', amount_kurus: amount })
        router.push({ pathname: '/checkout', params: { url: res.value.redirectUrl } })
      } else Alert.alert('Yükleme başlatılamadı', 'Lütfen tekrar dene ya da stüdyoyla iletişime geç.')
    } catch {
      Alert.alert('Hata', 'Yükleme başlatılamadı.')
    } finally {
      setBusy(null)
    }
  }

  async function buy(item: RetailItem) {
    if (balance < item.priceInKurus) {
      Alert.alert('Yetersiz bakiye', 'Önce cüzdanına para yükle.')
      return
    }
    setBusy(`buy-${item.id}`)
    try {
      const res = await api.walletBuy(item.id)
      if (res.ok) {
        track('wallet_purchase', { product_id: item.id })
        void wallet.reload()
        void store.reload()
        Alert.alert('Alındı', `${item.name} cüzdanından alındı.`)
      } else {
        const code = (res.error as { code?: string })?.code
        Alert.alert('Alınamadı', code === 'retail_out_of_stock' ? 'Ürün tükenmiş.' : code === 'wallet_insufficient' ? 'Bakiyen yetersiz.' : 'İşlem tamamlanamadı.')
      }
    } catch {
      Alert.alert('Hata', 'İşlem tamamlanamadı.')
    } finally {
      setBusy(null)
    }
  }

  const items = store.data ?? []
  const history = wallet.data?.history ?? []

  return (
    // `header`: the stack header above is real now, so do not add the top inset again.
    <Screen header refreshControl={<RefreshControl refreshing={wallet.loading} onRefresh={() => { void wallet.reload(); void store.reload() }} tintColor={p.accent} />}>
      <FadeInUp index={0}>
        <Hero>
          <Body style={[t.label, { color: p.onGradMuted }]}>CÜZDAN BAKİYEN</Body>
          <Body style={[t.display, { color: p.onGrad, fontSize: 40, lineHeight: 46 }]}>{formatKurus(balance)}</Body>
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(2) }}>
            {TOPUPS.map((a) => (
              <TopupChip key={a} amount={a} loading={busy === `top-${a}`} onPress={() => void topup(a)} />
            ))}
          </View>
        </Hero>
      </FadeInUp>

      <FadeInUp index={1}>
        <SectionHeader>Mağaza</SectionHeader>
        {items.length > 0 ? (
          items.map((item) => (
            <View key={item.id} style={{ marginBottom: space(3) }}>
              <PremiumCard>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="bag-handle-outline" size={20} color={p.primary} />
                  </View>
                  <View style={{ flex: 1, gap: space(1) }}>
                    <Txt role="h3" numberOfLines={1}>{item.name}</Txt>
                    <Txt role="caption" tone="muted">{formatKurus(item.priceInKurus)}{item.stock !== null && item.stock <= 5 ? ` · son ${item.stock}` : ''}</Txt>
                  </View>
                  <BuyButton disabled={balance < item.priceInKurus} loading={busy === `buy-${item.id}`} onPress={() => void buy(item)} />
                </View>
              </PremiumCard>
            </View>
          ))
        ) : (
          <EmptyState icon="bag-outline" title="Şu an satışta ürün yok" body="Stüdyo ürün eklediğinde burada görünür." />
        )}
      </FadeInUp>

      <FadeInUp index={2}>
        <SectionHeader>Hareketler</SectionHeader>
        {history.length > 0 ? (
          history.map((h) => <TxnRow key={h.id} txn={h} />)
        ) : (
          <EmptyState icon="swap-vertical-outline" title="Henüz hareket yok" body="Cüzdanına para yükleyerek başla." />
        )}
      </FadeInUp>
    </Screen>
  )
}

function TopupChip({ amount, loading, onPress }: { amount: number; loading: boolean; onPress: () => void }) {
  const p = usePalette()
  return (
    <Body
      onPress={loading ? undefined : onPress}
      style={{ flex: 1, textAlign: 'center', color: p.onGrad, fontWeight: '700', fontSize: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: '#FFFFFF22', borderWidth: 1, borderColor: '#FFFFFF33', overflow: 'hidden' }}
    >
      {loading ? '…' : `+${(amount / 100).toLocaleString('tr-TR')} ₺`}
    </Body>
  )
}

function BuyButton({ disabled, loading, onPress }: { disabled: boolean; loading: boolean; onPress: () => void }) {
  const p = usePalette()
  if (loading) return <ActivityIndicator color={p.primary} />
  return (
    <Body
      onPress={disabled ? undefined : onPress}
      style={[t.button, { color: disabled ? p.textMuted : p.onPrimary, backgroundColor: disabled ? p.surfaceMuted : p.primary, fontSize: 13.5, paddingVertical: 9, paddingHorizontal: 18, borderRadius: radius.md, overflow: 'hidden' }]}
    >
      Al
    </Body>
  )
}

function TxnRow({ txn }: { txn: WalletTxn }) {
  const p = usePalette()
  const isIn = txn.direction === 'in'
  return (
    <View style={{ marginBottom: space(2) }}>
      <PremiumCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
          <Ionicons name={isIn ? 'arrow-down-circle' : 'arrow-up-circle'} size={26} color={isIn ? p.success : p.textMuted} />
          <View style={{ flex: 1, gap: space(1) }}>
            <Txt role="h3" numberOfLines={1}>{txn.label}</Txt>
            <Txt role="caption" tone="muted">{d(txn.at)}</Txt>
          </View>
          <View style={{ alignItems: 'flex-end', gap: space(1) }}>
            <Txt role="h3" tone={isIn ? 'success' : 'primary'}>{isIn ? '+' : '−'}{formatKurus(txn.amount)}</Txt>
            <StatusChip label={formatKurus(txn.balanceAfter)} tone="neutral" />
          </View>
        </View>
      </PremiumCard>
    </View>
  )
}
