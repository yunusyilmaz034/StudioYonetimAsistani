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

/**
 * A photo of a cardio machine's screen, as bare base64 JPEG (no data-URL prefix) — taken now, or
 * picked from the library if she photographed it earlier. NOT cropped: the figures sit wherever the
 * machine puts them, and a forced square would cut half of them off.
 *
 * `'denied'` ⇒ she refused the camera; the caller says so and offers the library or typing instead.
 */
export async function screenPhotoBase64(source: 'camera' | 'library'): Promise<string | null | 'denied'> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.5, base64: true }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return 'denied'
  }
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options)
  if (res.canceled) return null
  return res.assets?.[0]?.base64 ?? null
}
