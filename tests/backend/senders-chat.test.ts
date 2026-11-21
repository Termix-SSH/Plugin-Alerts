import { describe, expect, it, vi } from "vitest";
import type { PluginFetchInit } from "@termix-ssh/plugin-sdk/backend";
import {
  PUSHOVER_URL,
  sendToChannel,
  validateChannelConfig,
  type OutgoingAlert,
  type SenderDeps,
} from "../../src/backend/senders.js";
import { maskConfig, mergeConfig } from "../../src/backend/channel-secrets.js";

const ALERT: OutgoingAlert = {
  title: "Disk <full>",
  body: "/data at 99%\nclean up",
  severity: "critical",
  category: "automations.notify",
  source: "automations",
  link: { url: "https://termix.example/hosts/1" },
};

const KEY_A = "a".repeat(30);
const KEY_B = "b".repeat(30);

function deps() {
  const calls: Array<{ url: string; init?: PluginFetchInit }> = [];
  const value: SenderDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response("ok");
    },
    privateAllowlist: async () => ["gotify.lan"],
    smtp: async () => null,
    sendMail: vi.fn(),
  };
  return { deps: value, calls };
}

describe("chat and push channels", () => {
  it("posts Slack text with the title in bold and escaped", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      {
        type: "slack",
        config: { url: "https://hooks.slack.com/services/T/B/x" },
      },
      ALERT,
      d,
    );
    const payload = JSON.parse(calls[0].init!.body!);
    expect(payload.text).toBe(
      "*Disk &lt;full&gt;*\n/data at 99%\nclean up\n<https://termix.example/hosts/1|Open in Termix>",
    );
  });

  it("posts Teams an adaptive card with an open link", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      { type: "teams", config: { url: "https://prod.logic.azure.com/wf" } },
      ALERT,
      d,
    );
    const payload = JSON.parse(calls[0].init!.body!);
    const card = payload.attachments[0];
    expect(card.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(card.content.body[0]).toMatchObject({
      text: "Disk <full>",
      color: "attention",
    });
    expect(card.content.actions[0].url).toBe("https://termix.example/hosts/1");
  });

  it("posts Gotify with the app token header and priority", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      {
        type: "gotify",
        config: {
          url: "http://gotify.lan/",
          token: "Atoken",
          allowPrivateNetwork: true,
        },
      },
      ALERT,
      d,
    );
    expect(calls[0].url).toBe("http://gotify.lan/message");
    expect(calls[0].init!.headers).toMatchObject({ "X-Gotify-Key": "Atoken" });
    expect(calls[0].init!.allowPrivateHosts).toEqual(["gotify.lan"]);
    expect(JSON.parse(calls[0].init!.body!)).toMatchObject({
      title: "Disk <full>",
      priority: 8,
      extras: {
        "client::notification": {
          click: { url: "https://termix.example/hosts/1" },
        },
      },
    });
  });

  it("posts Pushover with its keys and a high priority for critical", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      { type: "pushover", config: { token: KEY_A, userKey: KEY_B } },
      ALERT,
      d,
    );
    expect(calls[0].url).toBe(PUSHOVER_URL);
    expect(JSON.parse(calls[0].init!.body!)).toMatchObject({
      token: KEY_A,
      user: KEY_B,
      priority: 1,
      url: "https://termix.example/hosts/1",
    });
  });

  it("puts a Matrix message with escaped HTML and a bearer token", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      {
        type: "matrix",
        config: {
          url: "https://matrix.example",
          roomId: "!room:matrix.example",
          token: "syt_x",
        },
      },
      ALERT,
      d,
    );
    expect(calls[0].url).toMatch(
      /^https:\/\/matrix\.example\/_matrix\/client\/v3\/rooms\/!room%3Amatrix\.example\/send\/m\.room\.message\/termix-/,
    );
    expect(calls[0].init!.method).toBe("PUT");
    expect(calls[0].init!.headers).toMatchObject({
      Authorization: "Bearer syt_x",
    });
    const payload = JSON.parse(calls[0].init!.body!);
    expect(payload.msgtype).toBe("m.text");
    expect(payload.formatted_body).toContain(
      "<strong>Disk &lt;full&gt;</strong>",
    );
    expect(payload.formatted_body).toContain("99%<br>clean up");
  });
});

describe("validateChannelConfig for chat and push channels", () => {
  it("accepts good configs", () => {
    expect(
      validateChannelConfig("slack", {
        url: "https://hooks.slack.com/services/T/B/x",
      }),
    ).toBeNull();
    expect(
      validateChannelConfig("teams", { url: "https://x.logic.azure.com/a" }),
    ).toBeNull();
    expect(
      validateChannelConfig("gotify", { url: "https://g.example", token: "A" }),
    ).toBeNull();
    expect(
      validateChannelConfig("pushover", { token: KEY_A, userKey: KEY_B }),
    ).toBeNull();
    expect(
      validateChannelConfig("matrix", {
        url: "https://m.example",
        roomId: "!a:m.example",
        token: "t",
      }),
    ).toBeNull();
  });

  it("names what is wrong", () => {
    expect(
      validateChannelConfig("slack", { url: "https://example.com/hook" }),
    ).toMatch(/Slack/);
    expect(validateChannelConfig("teams", { url: "http://x" })).toMatch(
      /https/,
    );
    expect(
      validateChannelConfig("gotify", { url: "https://g.example" }),
    ).toMatch(/token/);
    expect(
      validateChannelConfig("pushover", { token: KEY_A, userKey: "short" }),
    ).toMatch(/user/);
    expect(
      validateChannelConfig("matrix", {
        url: "https://m.example",
        roomId: "#alias:m.example",
        token: "t",
      }),
    ).toMatch(/room id/);
  });
});

describe("chat and push channel secrets", () => {
  it("hides tokens and keys, and keeps them when sent empty", () => {
    const saved = { token: KEY_A, userKey: KEY_B };
    const masked = maskConfig("pushover", saved);
    expect(masked.config).toEqual({});
    expect(masked.saved).toEqual(["token", "userKey"]);
    expect(mergeConfig("pushover", {}, "pushover", saved)).toEqual(saved);
    expect(
      maskConfig("matrix", { url: "https://m", roomId: "!a:m", token: "t" })
        .config,
    ).toEqual({ url: "https://m", roomId: "!a:m" });
    expect(
      maskConfig("slack", { url: "https://hooks.slack.com/x" }).hints.url,
    ).toBe("https://hooks.slack.com");
  });
});
