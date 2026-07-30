# PROTOTYPE — Issue #69 encrypted relay

This throwaway prototype answers one question:

> Can a Cloudflare Durable Object Hibernatable WebSocket relay route bounded
> application ciphertext between a desktop and a mobile endpoint without
> learning the sentinel plaintext, while preserving one-use tickets, endpoint
> binding, replay rejection, offline recovery, backpressure and revocation?

It is deliberately isolated from the production control plane. It uses a
separate Worker name and Durable Object class, fixed fake endpoint identities,
throwaway HPKE keys and synthetic payloads only. It must never receive a real
Device Credential, character content, conversation, document or configuration.

Run the local interactive prototype:

```sh
npm run prototype:issue69-relay
```

Run the deterministic local scenario:

```sh
npm run prototype:issue69-relay:scenario
```

The scenario starts Wrangler in local mode, runs RFC 9180 Auth-mode known-answer
validation, exercises two Node endpoints, prints the complete observable state
after every gate and stops the local Worker. Cloud deployment and Android
validation are separate later gates; local success does not imply either one.

Run the same gates against an isolated deployed Worker:

```sh
ISSUE69_ORIGIN=https://example.workers.dev \
ISSUE69_RUN_TOKEN=throwaway-token \
NODE_USE_ENV_PROXY=1 \
npm run prototype:issue69-relay:remote
```

Add `ISSUE69_LONG_GATE=1` to exercise both the 30-second and 5-minute offline
recovery windows.

Keep the token out of shell history and logs. The deployed prototype must use
the separate Worker name from `wrangler.jsonc`; never point it at the production
control-plane Worker. `NODE_USE_ENV_PROXY=1` lets Node fetch use the standard
`HTTP_PROXY`/`HTTPS_PROXY` settings; the WebSocket client uses the same HTTPS
proxy when the target is `wss:`.

For an independent raw-byte audit without TLS interception, place the blind
forwarder between the endpoint and an explicit HTTP proxy:

```sh
ISSUE69_CAPTURE_DIRECTORY=/path/to/isolated-temporary-directory \
node prototype/issue69-relay/capture-forwarder.mjs
```

The forwarder listens on `127.0.0.1:7891`, forwards to `127.0.0.1:7890`, and
records at most 8 MiB in each direction for every TCP connection. It never
terminates TLS or logs decoded HTTP/WebSocket content. Use synthetic sentinel
data only, search the raw files for the exact sentinel, run token and protocol
markers, then permanently delete the capture directory. The listen/upstream
addresses, ports and byte limit can be changed with the corresponding
`ISSUE69_CAPTURE_*` environment variables.

Primary sources:

- [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)
- [RFC 9180 JSON test vectors](https://github.com/cfrg/draft-irtf-cfrg-hpke/blob/5f503c564da00b0687b3de75f1dfbdfc4079ad31/test-vectors.json)
- [hpke-js](https://github.com/dajiaji/hpke-js)
- [Cloudflare Hibernation WebSocket API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
