import { useEffect, useState } from 'react'
import { Image, Linking, Modal, Pressable, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Ionicons } from '@expo/vector-icons'

import type { HomeCampaign } from '@/lib/api'
import { Body } from './ui'
import { radius, space, usePalette } from '@/theme'

// The open-screen campaign popup (the Instagram creative). Frequency is capped on the DEVICE so it
// never harasses: shown at most ONCE PER DAY, silenced for good once "Bir daha gösterme" is tapped,
// and the ✕ is always there. It appears on a cold home mount only (not on every re-render).
const LAST = 'campaign_last_shown'
const DISMISSED = 'campaign_dismissed'
const todayKey = () => new Date().toISOString().slice(0, 10)

export function CampaignPopup({ campaign }: { campaign: HomeCampaign | null }) {
  const p = usePalette()
  const [show, setShow] = useState(false)
  const url = campaign?.imageUrl

  useEffect(() => {
    if (!url) return
    let alive = true
    // Once a day PER creative: a new campaign the owner just set shows even the same day; the same
    // creative shows at most once per day. (This also makes testing sane — change the image, it reappears.)
    const sig = `${todayKey()}|${url}`
    void (async () => {
      const [last, dismissed] = await Promise.all([AsyncStorage.getItem(LAST), AsyncStorage.getItem(DISMISSED)])
      if (!alive) return
      if (dismissed === url) return // she asked never to see this creative again
      if (last === sig) return // this exact creative already shown today
      setShow(true)
      await AsyncStorage.setItem(LAST, sig)
    })()
    return () => {
      alive = false
    }
  }, [url])

  if (!campaign?.imageUrl) return null

  const openCta = () => {
    if (campaign.ctaUrl) void Linking.openURL(campaign.ctaUrl).catch(() => {})
    setShow(false)
  }
  const never = async () => {
    await AsyncStorage.setItem(DISMISSED, campaign.imageUrl)
    setShow(false)
  }

  return (
    <Modal visible={show} transparent animationType="fade" onRequestClose={() => setShow(false)}>
      <View style={{ flex: 1, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center', padding: space(6) }}>
        <View style={{ width: '100%', maxWidth: 340, backgroundColor: p.surface, borderRadius: radius.xl, overflow: 'hidden' }}>
          <Pressable
            onPress={() => setShow(false)}
            hitSlop={10}
            style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, width: 34, height: 34, borderRadius: 17, backgroundColor: '#00000077', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
          <Image source={{ uri: campaign.imageUrl }} style={{ width: '100%', aspectRatio: 1 }} resizeMode="cover" />
          {campaign.title || (campaign.ctaLabel && campaign.ctaUrl) ? (
            <View style={{ padding: space(4), gap: space(3) }}>
              {campaign.title ? <Body strong style={{ fontSize: 16 }}>{campaign.title}</Body> : null}
              {campaign.ctaLabel && campaign.ctaUrl ? (
                <Pressable onPress={openCta} style={{ backgroundColor: p.accent, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' }}>
                  <Body style={{ color: '#FFFFFF', fontWeight: '800' }}>{campaign.ctaLabel}</Body>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Pressable onPress={() => void never()} hitSlop={8} style={{ paddingVertical: 11, alignItems: 'center' }}>
            <Body faint style={{ fontSize: 12.5 }}>Bir daha gösterme</Body>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
