import { Linking, Modal, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { WebView } from 'react-native-webview'

import { youtubeEmbedUrl } from '@studio/core/client'

import { PressableScale } from './motion'
import { Body, Button } from './ui'
import { API_BASE } from '@/config'
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
// The panel's own origin — the referrer the web player already embeds from successfully.
const PANEL_ORIGIN = new URL(API_BASE).origin

// The whole page: one iframe, filling a black box, nothing else. It exists to give the player a
// document with an origin — see the note at the WebView below.
const playerHtml = (embed: string) => `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"></head>
<body style="margin:0;background:#000;overflow:hidden">
<iframe src="${embed}" style="border:0;position:absolute;inset:0;width:100%;height:100%"
  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
</body>
</html>`

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
                // NOT `source={{ uri: embed }}` — that is what YouTube answers with "Hata 153 · video
                // oynatıcı yapılandırma hatası" (seen in the simulator, 2026-08-01). Loading the embed
                // URL as the top-level document gives the player no origin to check, and an embed with
                // no origin is exactly what YouTube's referrer rules refuse.
                //
                // So the iframe is put inside a page that HAS an origin — and the origin is OURS, not
                // a claim to be youtube.com. Claiming their domain fixed 153 and earned 152 instead
                // (origin verification), which is fair: it was a forged origin. The panel's domain is
                // the one the web player already embeds from, so the app now presents exactly the
                // referrer that works there. It is derived from `API_BASE` rather than written out,
                // so a studio on another domain does not need this file changed.
                source={{ html: playerHtml(embed), baseUrl: PANEL_ORIGIN }}
                originWhitelist={['*']}
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
