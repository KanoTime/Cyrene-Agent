import { registerRootComponent } from 'expo';
import { registerGlobals } from '@livekit/react-native';

import App from './App';

// LiveKit 的 WebRTC shim 必须在任何音视频代码之前注册。
registerGlobals();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
