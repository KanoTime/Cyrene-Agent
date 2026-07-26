/**
 * Converts the control-plane Base64URL call key into the exact key material
 * passed to LiveKit's native Android key provider.
 *
 * The native Android provider distinguishes passphrase strings from raw key
 * bytes, while rtc-node accepts only raw bytes. Both endpoints therefore use
 * this decoded 32-byte representation.
 */
export function toNativeE2eeKeyMaterial(
  encodedKey: string,
): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) {
    throw new Error("E2EE_REQUIRED");
  }
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const output: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of encodedKey) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("E2EE_REQUIRED");
    accumulator = (accumulator << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output.push((accumulator >> bitCount) & 0xff);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  if (output.length !== 32 || bitCount !== 2 || accumulator !== 0) {
    throw new Error("E2EE_REQUIRED");
  }
  return Uint8Array.from(output);
}

export interface MobileE2eeTransportPolicy {
  dataChannelEncryption: boolean;
  roomOption: "e2ee" | "encryption";
}

/**
 * rtc-node 0.13.x encrypts media frames but does not expose LiveKit data
 * packet encryption. Keep the React Native peer on the legacy frame-only
 * option so both endpoints enforce the same capability boundary.
 */
export function mobileE2eeTransportPolicy(): MobileE2eeTransportPolicy {
  return {
    dataChannelEncryption: false,
    roomOption: "e2ee",
  };
}
