import { themeCss, type StudioTheme } from '@/lib/theme/presets'

// Injects the studio's chosen palette + type size as `:root`/`html` overrides. Rendered after
// globals.css in the document, so these win. Server component — no client JS, no flash of the default
// theme (the values are already in the HTML the browser first paints). See PF-12.
export function ThemeStyle({ theme }: { theme: StudioTheme }) {
  return <style dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
}
