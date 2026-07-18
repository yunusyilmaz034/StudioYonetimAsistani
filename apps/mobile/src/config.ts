// Runtime configuration for the member app. None of this is secret: the Firebase web `apiKey` is a
// project IDENTIFIER (what protects the data is Auth + Firestore rules + the server-side member API),
// and the studio id + API base are public. The same values the web app ships (apphosting.yaml).

export const API_BASE = 'https://panel.pilatesfitnessbyisil.com/api/member'

// The single-studio pilot. When the platform onboards a second studio, this becomes a value chosen at
// login (or baked per white-label build) — the app is written so nothing else assumes "retro".
export const STUDIO_ID = 'retro'

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBYCZEFu-oxit5J9h_pgNnEfCyYyud1b0s',
  authDomain: 'studio-yonetim-prod.firebaseapp.com',
  projectId: 'studio-yonetim-prod',
  storageBucket: 'studio-yonetim-prod.firebasestorage.app',
} as const
