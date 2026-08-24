// M2 — register this device for push. Ask permission, get the Expo push token, and hand it to the
// member API (which stores it server-side and flips her `push` preference on). Best-effort: a member on
// a simulator or who declines simply gets no push, never a crash.
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { api } from './api'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export async function registerForPush(): Promise<void> {
  try {
    const settings = await Notifications.getPermissionsAsync()
    let status = settings.status
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status
    }
    if (status !== 'granted') return

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Bildirimler',
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync()
    if (token) await api.registerDevice(token, Platform.OS)
    else await api.reportPushFailure(Platform.OS, 'no_token')
  } catch (e) {
    // Push is a nice-to-have and must never block the app — but silence is not the same as
    // resilience. This catch used to be empty, and Android push was broken for months with nothing
    // anywhere able to say so: a failure looked exactly like a member who declined.
    //
    // Reporting is itself best-effort. If even this fails there is nothing further to try, and the
    // member must not notice any of it.
    try {
      await api.reportPushFailure(Platform.OS, e instanceof Error ? e.message : String(e))
    } catch {
      /* nothing left to do */
    }
  }
}
