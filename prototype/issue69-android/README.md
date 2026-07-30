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
