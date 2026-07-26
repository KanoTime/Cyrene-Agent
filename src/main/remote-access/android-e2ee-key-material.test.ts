import { describe, expect, it } from "vitest";
import {
  mobileE2eeTransportPolicy,
  toNativeE2eeKeyMaterial,
} from "../../../mobile/src/e2ee-key-material";

describe("Android LiveKit E2EE key representation", () => {
  it("passes the same 32 raw bytes that rtc-node uses on the desktop", () => {
    const encoded = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const material = toNativeE2eeKeyMaterial(encoded);

    expect(material).toBeInstanceOf(Uint8Array);
    expect(Array.from(material as Uint8Array)).toEqual(
      Array.from({ length: 32 }, (_, index) => index),
    );
  });

  it("keeps data-channel encryption off when the rtc-node peer supports only media-frame E2EE", () => {
    expect(mobileE2eeTransportPolicy()).toEqual({
      dataChannelEncryption: false,
      roomOption: "e2ee",
    });
  });
});
