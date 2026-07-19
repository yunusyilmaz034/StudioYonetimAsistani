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
import { Body, Card, Empty, Eyebrow, Hero, Loading, Pill, Screen } from '@/components/ui'
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
    <Screen refreshControl={<RefreshControl refreshing={wallet.loading} onRefresh={() => { void wallet.reload(); void store.reload() }} tintColor={p.accent} />}>
      <FadeInUp index={0}>
        <Hero>
          <Body style={[t.caption, { color: p.onGradMuted }]}>Cüzdan Bakiyen</Body>
          <Body style={[t.display, { color: p.onGrad, fontSize: 40, lineHeight: 46 }]}>{formatKurus(balance)}</Body>
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(2) }}>
            {TOPUPS.map((a) => (
              <TopupChip key={a} amount={a} loading={busy === `top-${a}`} onPress={() => void topup(a)} />
            ))}
          </View>
        </Hero>
      </FadeInUp>

      <FadeInUp index={1}>
        <Eyebrow>Mağaza</Eyebrow>
        {items.length > 0 ? (
          items.map((item, i) => (
            <Card key={item.id} style={{ marginBottom: space(2) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="bag-handle-outline" size={20} color={p.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body strong numberOfLines={1}>{item.name}</Body>
                  <Body muted style={{ fontSize: 13 }}>{formatKurus(item.priceInKurus)}{item.stock !== null && item.stock <= 5 ? ` · son ${item.stock}` : ''}</Body>
                </View>
                <BuyButton disabled={balance < item.priceInKurus} loading={busy === `buy-${item.id}`} onPress={() => void buy(item)} />
              </View>
            </Card>
          ))
        ) : (
          <Card><Empty icon={<Ionicons name="bag-outline" size={28} color={p.textFaint} />} text="Şu an satışta ürün yok." /></Card>
        )}
      </FadeInUp>

      <FadeInUp index={2}>
        <Eyebrow>Hareketler</Eyebrow>
        {history.length > 0 ? (
          history.map((h) => <TxnRow key={h.id} txn={h} />)
        ) : (
          <Card inset><Body muted>Henüz hareket yok. Cüzdanına para yükleyerek başla.</Body></Card>
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
  if (loading) return <ActivityIndicator color={p.accent} />
  return (
    <Body
      onPress={disabled ? undefined : onPress}
      style={{ color: disabled ? p.textFaint : '#FFFFFF', backgroundColor: disabled ? p.surfaceMuted : p.accent, fontWeight: '700', fontSize: 13.5, paddingVertical: 8, paddingHorizontal: 18, borderRadius: radius.md, overflow: 'hidden' }}
    >
      Al
    </Body>
  )
}

function TxnRow({ txn }: { txn: WalletTxn }) {
  const p = usePalette()
  const isIn = txn.direction === 'in'
  return (
    <Card inset style={{ marginBottom: space(2) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <Ionicons name={isIn ? 'arrow-down-circle' : 'arrow-up-circle'} size={26} color={isIn ? p.good : p.textMuted} />
        <View style={{ flex: 1 }}>
          <Body strong numberOfLines={1}>{txn.label}</Body>
          <Body faint style={{ fontSize: 12.5 }}>{d(txn.at)}</Body>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Body strong style={{ color: isIn ? p.good : p.text }}>{isIn ? '+' : '−'}{formatKurus(txn.amount)}</Body>
          <Pill label={formatKurus(txn.balanceAfter)} tone="muted" />
        </View>
      </View>
    </Card>
  )
}
