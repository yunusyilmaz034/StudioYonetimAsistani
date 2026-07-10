import { notFound } from 'next/navigation'

import { DesignSystemShowcase } from './showcase'

// Development-only surface (Doc 09 §12). It is the visual contract for the
// foundation components — not a business screen and not part of the product. In a
// production build it returns 404, so it can never be reached by a real user.
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <DesignSystemShowcase />
}
