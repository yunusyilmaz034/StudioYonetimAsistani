'use client'

import { youtubeEmbedUrl } from '@studio/core/client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

// THE FORM VIDEO, PLAYED WHERE SHE IS (owner, 2026-08-01).
//
// *"Video için youtube yönlendirmesin, sistem pratik olmuyor."* A fifteen-second form clip used to
// open a new tab (web) or leave the app entirely (mobile). She watches it, comes back, and has lost
// her place in the programme — which is the whole reason the clip is next to the exercise instead of
// in a playlist somewhere.
//
// So it plays in a popup, over the programme, and closing it puts her back exactly where she was.
// The mobile app does the same thing with a WebView; both build the URL with the same shared
// `youtubeEmbedUrl`, so a link that plays in one plays in the other.
//
// A link that is NOT YouTube (a Drive file, a Vimeo page, anything a trainer might paste) cannot be
// embedded honestly, so it is not faked: the dialog says so and offers the plain link. Better a
// visible exception than a silent black rectangle.
export function VideoDialog({
  url,
  title,
  onClose,
}: {
  url: string
  title: string
  onClose: () => void
}) {
  const embed = youtubeEmbedUrl(url)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle className="text-base">{title}</DialogTitle>
        {embed ? (
          // 16:9, and it scales with the dialog rather than with the viewport — on a 375px phone the
          // dialog is the width of the screen, and the video is the width of the dialog.
          <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '16 / 9' }}>
            <iframe
              src={embed}
              title={title}
              className="absolute inset-0 size-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <p className="text-sm text-muted-foreground">
              Bu video burada oynatılamıyor — YouTube bağlantısı değil.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-primary underline underline-offset-2"
            >
              Videoyu yeni sekmede aç
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
