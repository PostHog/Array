import { describe, expect, it } from "vitest";
import { mapAppServerNotification } from "./mapping";
import { APP_SERVER_NOTIFICATIONS } from "./protocol";

describe("mapAppServerNotification", () => {
  it("maps an agent message delta to an ACP agent_message_chunk", () => {
    const result = mapAppServerNotification(
      "s-1",
      APP_SERVER_NOTIFICATIONS.AGENT_MESSAGE_DELTA,
      { itemId: "item_1", text: "Hello" },
    );

    expect(result).toEqual({
      sessionId: "s-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      },
    });
  });

  it("returns null when the text is missing or empty", () => {
    expect(
      mapAppServerNotification(
        "s-1",
        APP_SERVER_NOTIFICATIONS.AGENT_MESSAGE_DELTA,
        {},
      ),
    ).toBeNull();
    expect(
      mapAppServerNotification(
        "s-1",
        APP_SERVER_NOTIFICATIONS.AGENT_MESSAGE_DELTA,
        { itemId: "item_1", text: "" },
      ),
    ).toBeNull();
  });

  it("returns null for notifications not yet mapped in the spike", () => {
    expect(
      mapAppServerNotification("s-1", APP_SERVER_NOTIFICATIONS.TURN_COMPLETED, {
        usage: { input_tokens: 10 },
      }),
    ).toBeNull();
  });
});
