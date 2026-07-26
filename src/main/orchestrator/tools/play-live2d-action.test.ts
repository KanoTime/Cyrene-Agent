import { describe, expect, it, vi } from "vitest";
import { SEMANTIC_ACTIONS, findSemanticAction } from "../../../shared/semantic-actions";
import type { CharacterVisualContext } from "../../character/character-visual";
import { IPC } from "../../../shared/ipc-channels";
import { createPlayLive2DActionHandler, type PlayLive2DActionDeps } from "./play-live2d-action";

type SendMock = ReturnType<typeof vi.fn<(channel: string, payload?: unknown) => void>>;

function makeDeps(): Omit<PlayLive2DActionDeps, "sendToLive2DWindow"> & { sendToLive2DWindow: SendMock } {
  const available = SEMANTIC_ACTIONS.map((action) => action.alias);
  return {
    sendToLive2DWindow: vi.fn<(channel: string, payload?: unknown) => void>(),
    getVisualContext: (): CharacterVisualContext => ({
      presentation: { kind: "live2d", characterId: "fixture", modelUrl: "local-character://fixture/live2d/model.json" },
      availableActions: available,
      resolveAction: (input: string) => {
        const action = findSemanticAction(input);
        if (!action) return { kind: "noop", reason: "unknown_action", available } as const;
        if (action.id === "wink") {
          return { kind: "play", actionId: action.id, target: { kind: "motion", group: "动作#6", motionName: "Wink~" } } as const;
        }
        return { kind: "play", actionId: action.id, target: { kind: "expression", name: action.id } } as const;
      },
    }),
  };
}

describe("play-live2d-action handler", () => {
  it("emits IPC with a resolved motion target for a valid alias", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);
    const result = await handler({ name: "眨眨眼" }, undefined);

    expect(JSON.parse(result)).toMatchObject({ ok: true });
    expect(deps.sendToLive2DWindow).toHaveBeenCalledTimes(1);
    const [channel, payload] = deps.sendToLive2DWindow.mock.calls[0];
    expect(channel).toBe(IPC.LIVE2D_PLAY_ACTION);
    expect(payload).toEqual({
      kind: "motion",
      group: "动作#6",
      motionName: "Wink~",
    });
  });

  it("emits IPC with a resolved expression target for a valid alias", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);
    const result = await handler({ name: "戴墨镜" }, undefined);

    expect(JSON.parse(result)).toMatchObject({ ok: true });
    expect(deps.sendToLive2DWindow.mock.calls[0][1]).toEqual({
      kind: "expression",
      name: "cool",
    });
  });

  it("returns unknown_action and never sends IPC for an invalid alias", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);
    const result = await handler({ name: "挥手" }, undefined);

    expect(JSON.parse(result)).toMatchObject({ ok: false, error: "unknown_action" });
    expect(Array.isArray((JSON.parse(result) as { available: string[] }).available)).toBe(true);
    expect((JSON.parse(result) as { available: string[] }).available.length).toBe(SEMANTIC_ACTIONS.length);
    expect(deps.sendToLive2DWindow).not.toHaveBeenCalled();
  });

  it("returns unknown_action when name is missing or not a string", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);

    expect(JSON.parse(await handler({}, undefined))).toMatchObject({ ok: false, error: "unknown_action" });
    expect(JSON.parse(await handler({ name: "" }, undefined))).toMatchObject({ ok: false, error: "unknown_action" });
    expect(JSON.parse(await handler({ name: 123 }, undefined))).toMatchObject({ ok: false, error: "unknown_action" });
    expect(deps.sendToLive2DWindow).not.toHaveBeenCalled();
  });

  it("returns a diagnostic no-op and sends no IPC when the active character lacks the action", async () => {
    const deps = makeDeps();
    deps.getVisualContext = () => ({
      presentation: { kind: "static", characterId: "fixture.lumen", avatarUrl: "local-character://fixture.lumen/avatar" },
      availableActions: [],
      resolveAction: () => ({
        kind: "noop",
        actionId: "wink",
        reason: "live2d_unavailable",
        available: [],
      }),
    });
    const handler = createPlayLive2DActionHandler(deps);

    expect(JSON.parse(await handler({ name: "眨眨眼" }, undefined))).toEqual({
      ok: false,
      error: "action_unavailable",
      reason: "live2d_unavailable",
      available: [],
    });
    expect(deps.sendToLive2DWindow).not.toHaveBeenCalled();
  });

  it("swallows IPC failures and returns ipc_failed", async () => {
    const deps = makeDeps();
    deps.sendToLive2DWindow.mockImplementation(() => { throw new Error("ipc boom"); });
    const handler = createPlayLive2DActionHandler(deps);
    const result = await handler({ name: "笑一笑" }, undefined);

    expect(JSON.parse(result)).toMatchObject({ ok: false, error: "ipc_failed" });
  });

  it("available list matches the catalog aliases", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);
    const result = JSON.parse(await handler({ name: "挥手" }, undefined)) as { available: string[] };
    for (const a of SEMANTIC_ACTIONS) {
      expect(result.available).toContain(a.alias);
    }
  });

  it("findSemanticAction is consistent with catalog (sanity)", () => {
    for (const a of SEMANTIC_ACTIONS) {
      expect(findSemanticAction(a.alias)?.alias).toBe(a.alias);
    }
  });
});
