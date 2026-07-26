import {
  type DeviceAuthorizationPersistentState,
  InMemoryDeviceAuthorizationModule,
} from "./device-authorization";

export interface DeviceAuthorizationAggregateStore {
  transact<T>(
    operation: (
      state: DeviceAuthorizationPersistentState | null,
    ) => Promise<{
      nextState: DeviceAuthorizationPersistentState;
      result: T;
    }>,
  ): Promise<T>;
}

export class InMemoryDeviceAuthorizationAggregateStore
implements DeviceAuthorizationAggregateStore {
  #state: DeviceAuthorizationPersistentState | null = null;
  #mutationQueue: Promise<void> = Promise.resolve();

  transact<T>(
    operation: (
      state: DeviceAuthorizationPersistentState | null,
    ) => Promise<{
      nextState: DeviceAuthorizationPersistentState;
      result: T;
    }>,
  ): Promise<T> {
    const pending = this.#mutationQueue.then(async () => {
      const current = this.#state ? structuredClone(this.#state) : null;
      const { nextState, result } = await operation(current);
      this.#state = structuredClone(nextState);
      return result;
    });
    this.#mutationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

export class PersistentDeviceAuthorizationModule {
  readonly #store: DeviceAuthorizationAggregateStore;
  readonly #now?: () => number;

  constructor(options: {
    store: DeviceAuthorizationAggregateStore;
    now?: () => number;
  }) {
    this.#store = options.store;
    this.#now = options.now;
  }

  bootstrapOwner(
    input: Parameters<InMemoryDeviceAuthorizationModule["bootstrapOwner"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["bootstrapOwner"]>> {
    return this.#run((authorization) => authorization.bootstrapOwner(input));
  }

  confirmOwnerRecoveryKey(
    input: Parameters<
      InMemoryDeviceAuthorizationModule["confirmOwnerRecoveryKey"]
    >[0],
  ): Promise<
    ReturnType<InMemoryDeviceAuthorizationModule["confirmOwnerRecoveryKey"]>
  > {
    return this.#run((authorization) =>
      authorization.confirmOwnerRecoveryKey(input));
  }

  reportDesktopAvailability(
    input: Parameters<
      InMemoryDeviceAuthorizationModule["reportDesktopAvailability"]
    >[0],
  ): Promise<
    ReturnType<InMemoryDeviceAuthorizationModule["reportDesktopAvailability"]>
  > {
    return this.#run((authorization) =>
      authorization.reportDesktopAvailability(input));
  }

  requestVoiceCall(
    input: Parameters<InMemoryDeviceAuthorizationModule["requestVoiceCall"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["requestVoiceCall"]>> {
    return this.#run((authorization) => authorization.requestVoiceCall(input));
  }

  confirmVoiceCall(
    input: Parameters<InMemoryDeviceAuthorizationModule["confirmVoiceCall"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["confirmVoiceCall"]>> {
    return this.#run((authorization) => authorization.confirmVoiceCall(input));
  }

  readVoiceCall(
    input: Parameters<InMemoryDeviceAuthorizationModule["readVoiceCall"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["readVoiceCall"]>> {
    return this.#run((authorization) => authorization.readVoiceCall(input));
  }

  readPendingDesktopVoiceCall(
    input: Parameters<
      InMemoryDeviceAuthorizationModule["readPendingDesktopVoiceCall"]
    >[0],
  ): Promise<
    ReturnType<InMemoryDeviceAuthorizationModule["readPendingDesktopVoiceCall"]>
  > {
    return this.#run((authorization) =>
      authorization.readPendingDesktopVoiceCall(input));
  }

  attachMediaGrantEnvelopes(
    input: Parameters<
      InMemoryDeviceAuthorizationModule["attachMediaGrantEnvelopes"]
    >[0],
  ): Promise<
    ReturnType<InMemoryDeviceAuthorizationModule["attachMediaGrantEnvelopes"]>
  > {
    return this.#run((authorization) =>
      authorization.attachMediaGrantEnvelopes(input));
  }

  takeMediaGrantEnvelope(
    input: Parameters<
      InMemoryDeviceAuthorizationModule["takeMediaGrantEnvelope"]
    >[0],
  ): Promise<
    ReturnType<InMemoryDeviceAuthorizationModule["takeMediaGrantEnvelope"]>
  > {
    return this.#run((authorization) =>
      authorization.takeMediaGrantEnvelope(input));
  }

  reportVoiceCallMediaReady(
    input: Parameters<
      InMemoryDeviceAuthorizationModule["reportVoiceCallMediaReady"]
    >[0],
  ): Promise<
    ReturnType<InMemoryDeviceAuthorizationModule["reportVoiceCallMediaReady"]>
  > {
    return this.#run((authorization) =>
      authorization.reportVoiceCallMediaReady(input));
  }

  terminateVoiceCall(
    input: Parameters<InMemoryDeviceAuthorizationModule["terminateVoiceCall"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["terminateVoiceCall"]>> {
    return this.#run((authorization) =>
      authorization.terminateVoiceCall(input));
  }

  recoverOwner(
    input: Parameters<InMemoryDeviceAuthorizationModule["recoverOwner"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["recoverOwner"]>> {
    return this.#run((authorization) => authorization.recoverOwner(input));
  }

  beginPairing(
    input: Parameters<InMemoryDeviceAuthorizationModule["beginPairing"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["beginPairing"]>> {
    return this.#run((authorization) => authorization.beginPairing(input));
  }

  claimPairing(
    input: Parameters<InMemoryDeviceAuthorizationModule["claimPairing"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["claimPairing"]>> {
    return this.#run((authorization) => authorization.claimPairing(input));
  }

  claimPairingWithShortCode(
    input: Parameters<
      InMemoryDeviceAuthorizationModule["claimPairingWithShortCode"]
    >[0],
  ): Promise<
    ReturnType<InMemoryDeviceAuthorizationModule["claimPairingWithShortCode"]>
  > {
    return this.#run((authorization) =>
      authorization.claimPairingWithShortCode(input));
  }

  getPairingReview(
    input: Parameters<InMemoryDeviceAuthorizationModule["getPairingReview"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["getPairingReview"]>> {
    return this.#run((authorization) => authorization.getPairingReview(input));
  }

  decidePairing(
    input: Parameters<InMemoryDeviceAuthorizationModule["decidePairing"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["decidePairing"]>> {
    return this.#run((authorization) => authorization.decidePairing(input));
  }

  readPairingOutcome(
    input: Parameters<InMemoryDeviceAuthorizationModule["readPairingOutcome"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["readPairingOutcome"]>> {
    return this.#run((authorization) => authorization.readPairingOutcome(input));
  }

  getAuthorizationSnapshot(
    authorizingCredential: string,
  ): Promise<ReturnType<
    InMemoryDeviceAuthorizationModule["getAuthorizationSnapshot"]
  >> {
    return this.#run((authorization) =>
      authorization.getAuthorizationSnapshot(authorizingCredential));
  }

  authorizeDevice(
    deviceCredential: string,
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["authorizeDevice"]>> {
    return this.#run((authorization) =>
      authorization.authorizeDevice(deviceCredential));
  }

  revokeDevice(
    input: Parameters<InMemoryDeviceAuthorizationModule["revokeDevice"]>[0],
  ): Promise<ReturnType<InMemoryDeviceAuthorizationModule["revokeDevice"]>> {
    return this.#run((authorization) => authorization.revokeDevice(input));
  }

  #run<T>(operation: (authorization: InMemoryDeviceAuthorizationModule) => T): Promise<T> {
    return this.#store.transact(async (state) => {
      const authorization = new InMemoryDeviceAuthorizationModule({
        now: this.#now,
        persistentState: state ?? undefined,
      });
      const result = operation(authorization);
      return {
        nextState: authorization.exportPersistentState(),
        result,
      };
    });
  }
}
