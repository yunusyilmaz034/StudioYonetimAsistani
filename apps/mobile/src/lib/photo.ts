// Pick a photo from the library, compressed + square, as a base64 data URL ready to upload.
// `launchImageLibraryAsync` uses the system PHPicker, which does NOT require photo-library permission
// (and asking for it crashes when the Info.plist string is absent) — so we open it directly.
import * as ImagePicker from 'expo-image-picker'

export async function pickPhotoDataUrl(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.5,
    base64: true,
  })
  if (res.canceled) return null
  const asset = res.assets?.[0]
  if (!asset?.base64) return null
  return `data:image/jpeg;base64,${asset.base64}`
}
