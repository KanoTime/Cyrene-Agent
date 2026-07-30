# Issue #69 Android endpoint prototype

This is a throwaway, standalone Expo development app. It deliberately has a
separate Android package and does not import or modify the production mobile
entry point, app configuration, credentials, content or EAS project.

```sh
npm install
npm run typecheck
npx expo prebuild --platform android --clean --no-install
```

Build locally with Android Studio's JBR:

```sh
JAVA_HOME=/Applications/Android\ Studio.app/Contents/jbr/Contents/Home \
ANDROID_HOME=$HOME/Library/Android/sdk \
ANDROID_SDK_ROOT=$HOME/Library/Android/sdk \
./android/gradlew -p android assembleDebug
```

Do not submit this prototype to EAS or an app store.

The `9. 50 次连接计时` gate issues a fresh one-use ticket for every attempt,
opens and closes 50 WebSockets, and renders success count plus p50/p95/max from
the Android endpoint's own monotonic clock. Run it only with the isolated
Worker and throwaway Keychain token. Record the active Android transport before
the run; the result does not identify Wi-Fi, cellular or VPN by itself. The gate
stops early after three consecutive failures so an unavailable network cannot
leave the phone in a long timeout loop.
