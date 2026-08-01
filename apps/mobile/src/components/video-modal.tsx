import { Linking, Modal, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { WebView } from 'react-native-webview'

import { youtubeEmbedUrl } from '@studio/core/client'

import { PressableScale } from './motion'
import { Body, Button } from './ui'
import { radius, space, usePalette } from '@/theme'

// THE FORM VIDEO, PLAYED IN THE APP (owner, 2026-08-01).
//
// *"Video için youtube yönlendirmesin, sistem pratik olmuyor."* Opening YouTube meant leaving the app
// — she watches fifteen seconds, comes back to a cold start, and has lost her place in the programme.
// Now it plays over the programme and closing it puts her back exactly where she was. The web panel
// does the same thing with an iframe; both build the URL with the shared `youtubeEmbedUrl`.
//
// A non-YouTube link cannot be embedded honestly, so it is not faked: the sheet says so and offers to
// open it outside. A visible exception beats a silent black rectangle.
export function VideoModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const p = usePalette()
  const embed = youtubeEmbedUrl(url)

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#000000CC', padding: space(4) }}>
        <View style={{ gap: space(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3) }}>
            <Body strong numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 16, flex: 1 }}>
              {title}
            </Body>
            <PressableScale onPress={onClose}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </View>
            </PressableScale>
          </View>

          {embed ? (
            <View style={{ aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
              <WebView
                source={{ uri: embed }}
                // Without these the player refuses to start inline on iOS and takes over the screen —
                // which is the jump out of context this whole change removes.
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                domStorageEnabled
                allowsFullscreenVideo
                style={{ backgroundColor: '#000' }}
              />
            </View>
          ) : (
            <View style={{ backgroundColor: p.bgElevated, borderRadius: radius.lg, padding: space(4), gap: space(3) }}>
              <Body muted>Bu video uygulamada oynatılamıyor — YouTube bağlantısı değil.</Body>
              <Button label="Tarayıcıda aç" onPress={() => void Linking.openURL(url)} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}
