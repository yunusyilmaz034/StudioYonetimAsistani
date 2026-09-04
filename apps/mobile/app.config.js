// The white-label build (Faz A4). One code base, one release cycle, N studios — which studio a build
// is FOR is chosen here, from an environment variable, and everything studio-specific comes out of a
// profile in `studios/`.
//
//   npx eas build --platform ios --profile production            # STUDIO defaults to 'retro'
//   STUDIO=novozen npx eas build --platform ios --profile production
//
// ── Why a file and not a flag per value ────────────────────────────────────────────────────
// A white-label build differs in about ten places — name, two bundle ids, an EAS project, an API
// base, three assets, a colour. Ten flags on a build command is ten chances to ship a studio's app
// under another studio's bundle identifier, and a bundle identifier is the one mistake the stores do
// not let you take back. A named profile is reviewed once, in a pull request, and then repeated
// exactly.
//
// ── What is deliberately NOT per studio ────────────────────────────────────────────────────
//   • `version` — releases go out in a BATCH (PRODUCT-ROADMAP §8). Five customers each on their own
//     version is five review queues and no way to say what "the app" does.
//   • The Firebase project — the platform is multi-tenant on ONE project; the studio is a
//     `studioId`, not a project. That is the architecture's first sentence.
//   • Permissions, plugins, the router, the New Architecture flag — same app, same behaviour.
//
// ── The guard ──────────────────────────────────────────────────────────────────────────────
// An unknown STUDIO throws rather than falling back to the pilot. Silently building Işıl's app when
// somebody typed `STUDIO=novosen` is exactly the failure this file exists to prevent: it would reach
// the stores looking correct and pointing at another studio's data.
const fs = require('node:fs')
const path = require('node:path')

const STUDIO = process.env.STUDIO ?? 'retro'
const profilePath = path.join(__dirname, 'studios', `${STUDIO}.json`)

if (!fs.existsSync(profilePath)) {
  const known = fs
    .readdirSync(path.join(__dirname, 'studios'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
  throw new Error(
    `Bilinmeyen stüdyo '${STUDIO}'. studios/${STUDIO}.json yok. Tanımlı olanlar: ${known.join(', ')}`,
  )
}

const studio = JSON.parse(fs.readFileSync(profilePath, 'utf8'))

for (const key of [
  'studioId',
  'displayName',
  'slug',
  'scheme',
  'bundleIdentifier',
  'androidPackage',
  'easProjectId',
  'apiBase',
]) {
  if (!studio[key]) throw new Error(`studios/${STUDIO}.json eksik: '${key}'`)
}

module.exports = () => ({
  expo: {
    name: studio.displayName,
    slug: studio.slug,
    owner: 'yunusyilmaz34',
    // Shared on purpose — see the note above about batched releases.
    //
    // 1.7.1 (owner, 2026-09-03). **BU DOSYA SIRADAKİ SÜRÜMÜ SÖYLEMEZ — çıkanı söyler.** 1.7.0 burada
    // yazılı kaldığı sürece "sıradaki 1.7.0" sanılıyordu; oysa `pnpm android:tracks` 1.7.0'ın Android
    // ÜRETİMİNDE (versionCode 13, %100) yayında olduğunu gösterdi. Aynı adla ikinci bir yayın,
    // "üyede hangi 1.7.0 var" sorusunu cevapsız bırakırdı.
    //
    // Yama sürümü, çünkü taşıdığı şey üç DÜZELTME: hibrit demet tek kart · ileri tarihli paketin
    // başlangıcı · fitness giriş satırı. Yeni ekran yok.
    //
    // versionCode / buildNumber BURADA YAZMAZ: `eas.json` `appVersionSource: "remote"` +
    // `autoIncrement`. Elle bir numara yazmak, uzaktaki sayaçla yarışmak olur.
    //
    // 1.7.2 (owner, 2026-09-04) — yine bir YAMA: kafe hesabı ekranı. 1.7.1'in taşıdığı hibrit kartı
    // ve ileri tarihli paket düzeltmeleri de bu sürümle birlikte gidiyor (iOS incelemesi sürüyordu).
    version: '1.7.2',
    orientation: 'portrait',
    scheme: studio.scheme,
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    icon: studio.icon,
    splash: {
      image: studio.splashImage,
      resizeMode: 'contain',
      backgroundColor: studio.backgroundColor,
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: studio.bundleIdentifier,
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    },
    android: {
      package: studio.androidPackage,
      // ANDROID PUSH (2026-08-25). Without this file the build has no Firebase project to talk to,
      // and `getExpoPushTokenAsync` fails on every Android device — which is exactly what had been
      // happening, silently, since the app shipped. Not a secret: it is compiled into the APK and
      // readable by anyone who has one. Access is decided by Firestore rules, never by this file.
      //
      // WHITE-LABEL: one file per studio when a second customer arrives, keyed the same way as
      // `studios/<id>.json`. One studio, one Firebase project, one config.
      googleServicesFile: './google-services.json',
      adaptiveIcon: {
        foregroundImage: studio.adaptiveIcon,
        backgroundColor: studio.backgroundColor,
      },
      permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-notifications',
      [
        'expo-camera',
        {
          cameraPermission:
            'Kiosk ekranındaki QR kodunu okutup giriş yapabilmen için kamera erişimi gerekir.',
        },
      ],
      [
        'expo-image-picker',
        { photosPermission: 'Profil fotoğrafını seçebilmen için galerine erişim gerekir.' },
      ],
    ],
    experiments: { typedRoutes: true },
    extra: {
      router: {},
      eas: { projectId: studio.easProjectId },
      // Read at RUNTIME by src/config.ts. The build's studio travels inside the build rather than
      // being compiled into a constant somebody has to remember to change.
      studioId: studio.studioId,
      apiBase: studio.apiBase,
      displayName: studio.displayName,
    },
  },
})
