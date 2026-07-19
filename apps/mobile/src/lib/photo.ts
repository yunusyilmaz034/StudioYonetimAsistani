// Pick a photo from the library, compressed + square, as a base64 data URL ready to upload. Uses
// expo-image-picker (a native module) — added in the SDK-54 rebuild.
import * as ImagePicker from 'expo-image-picker'

export async function pickPhotoDataUrl(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) return null
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
