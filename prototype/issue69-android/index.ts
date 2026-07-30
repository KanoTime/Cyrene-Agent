import { registerRootComponent } from "expo";
import { install } from "react-native-quick-crypto";

import App from "./src/Issue69RelayPrototypeApp";

install();
registerRootComponent(App);
