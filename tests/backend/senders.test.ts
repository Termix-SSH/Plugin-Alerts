import { describe, expect, it, vi } from "vitest";
import type { PluginFetchInit } from "@termix-ssh/plugin-sdk/backend";
import {
  describeSendError,
  parseRecipients,
  sendToChannel,
  validateChannelConfig,
  type OutgoingAlert,
  type SenderDeps,
} from "../../src/backend/senders.js";
import { matchesCategory, severityRank } from "../../src/types.js";
import { parseAllowlist } from "../../src/backend/index.js";
import { cleanLink } from "../../src/backend/hub.js";

const ALERT: OutgoingAlert = {
  title: "Disk full",
  body: "/data at 99%",
  severity: "critical",
  category: "automations.notify",
  source: "automations",
  link: { url: "https://termix.example/hosts/1" },
};

function deps(response = new Response("ok")) {
  const calls: Array<{ url: string; init?: PluginFetchInit }> = [];
  const value: SenderDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response;
    },
    privateAllowlist: async () => ["ntfy.lan"],
    smtp: async () => null,
    sendMail: vi.fn(),
  };
  return { deps: value, calls };
}

describe("sendToChannel", () => {
  it("posts ntfy with its priority, tag, click link and token", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      {
        type: "ntfy",
        config: { url: "https://ntfy.sh/", topic: "ops", token: "tk_1" },
      },
      ALERT,
      d,
    );
    expect(calls).toEqual([
      {
        url: "https://ntfy.sh/ops",
        init: expect.objectContaining({
          method: "POST",
          body: "/data at 99%",
          allowPrivateHosts: [],
          headers: {
            Title: "Disk full",
            Priority: "5",
            Tags: "rotating_light",
            Click: "https://termix.example/hosts/1",
            Authorization: "Bearer tk_1",
          },
        }),
      },
    ]);
  });

  it("sends a non-ASCII ntfy title and link as ASCII headers", async () => {
    const title = "Approval needed: Größe „x“ 🔔";
    const body = "Größe „x“ überschritten… ✅";
    const { deps: d, calls } = deps();
    await sendToChannel(
      { type: "ntfy", config: { url: "https://ntfy.sh", topic: "t" } },
      { ...ALERT, title, body, link: { url: "https://termix.example/a?c=ä" } },
      d,
    );
    const { headers } = calls[0].init!;
    expect(headers).toMatchObject({
      Title: `=?UTF-8?B?${Buffer.from(title).toString("base64")}?=`,
      Click: "https://termix.example/a?c=%C3%A4",
    });
    expect(Object.values(headers!).join("")).toMatch(/^[\x20-\x7e]*$/);
    expect(calls[0].init!.body).toBe(body);
  });

  it("encodes an ASCII ntfy title only when it looks encoded", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      { type: "ntfy", config: { url: "https://ntfy.sh", topic: "t" } },
      { ...ALERT, title: "=?x?=" },
      d,
    );
    expect(calls[0].init!.headers!.Title).toBe("=?UTF-8?B?PT94Pz0=?=");
  });

  it("posts a Discord embed", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      {
        type: "discord",
        config: {
          url: "https://discord.com/api/webhooks/1/abc",
          username: "Termix",
        },
      },
      ALERT,
      d,
    );
    const payload = JSON.parse(calls[0].init!.body!);
    expect(payload).toMatchObject({
      username: "Termix",
      embeds: [
        {
          title: "Disk full",
          description: "/data at 99%",
          color: 15158332,
          url: "https://termix.example/hosts/1",
        },
      ],
    });
  });

  it("puts on the webhook's own method and headers", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      {
        type: "webhook",
        config: {
          url: "https://hooks.example",
          method: "PUT",
          headers: { Authorization: "Bearer x" },
        },
      },
      ALERT,
      d,
    );
    expect(calls[0].init).toMatchObject({
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer x",
      },
    });
  });

  it("throws with the status when the receiver refuses", async () => {
    const { deps: d } = deps(
      new Response("slow down", { status: 429, statusText: "Too Many" }),
    );
    await expect(
      sendToChannel(
        { type: "webhook", config: { url: "https://hooks.example" } },
        ALERT,
        d,
      ),
    ).rejects.toThrow("HTTP 429 Too Many: slow down");
  });

  it("never links to anything but http(s)", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      { type: "ntfy", config: { url: "https://ntfy.sh", topic: "t" } },
      { ...ALERT, link: { url: "javascript:alert(1)" } },
      d,
    );
    expect(calls[0].init!.headers).not.toHaveProperty("Click");
  });
});

describe("validateChannelConfig", () => {
  it("accepts a working config of each type", () => {
    expect(
      validateChannelConfig("webhook", { url: "https://a.example" }),
    ).toBeNull();
    expect(
      validateChannelConfig("ntfy", { url: "https://ntfy.sh", topic: "t" }),
    ).toBeNull();
    expect(
      validateChannelConfig("discord", {
        url: "https://discordapp.com/api/webhooks/1/x",
      }),
    ).toBeNull();
    expect(
      validateChannelConfig("email", { to: "a@example.com; b@example.org" }),
    ).toBeNull();
  });

  it("names what is missing", () => {
    expect(validateChannelConfig("ntfy", { url: "https://ntfy.sh" })).toMatch(
      /topic/,
    );
    expect(validateChannelConfig("email", { to: "" })).toMatch(/address/);
  });
});

describe("helpers", () => {
  it("splits email recipients on commas, semicolons and spaces", () => {
    expect(parseRecipients("a@x.io, b@x.io;c@x.io  d@x.io")).toEqual([
      "a@x.io",
      "b@x.io",
      "c@x.io",
      "d@x.io",
    ]);
  });

  it("matches categories by pattern", () => {
    expect(matchesCategory("*", "docker.stopped")).toBe(true);
    expect(matchesCategory("", "docker.stopped")).toBe(true);
    expect(matchesCategory("docker.*", "docker.stopped")).toBe(true);
    expect(matchesCategory("docker.*", "dockerx.stopped")).toBe(false);
    expect(
      matchesCategory("acme-ssl.renewal_failed", "acme-ssl.renewal_failed"),
    ).toBe(true);
    expect(matchesCategory("acme-ssl.renewal_failed", "acme-ssl.other")).toBe(
      false,
    );
  });

  it("orders severities with success alongside info", () => {
    expect(severityRank("info")).toBe(severityRank("success"));
    expect(severityRank("warning")).toBeGreaterThan(severityRank("info"));
    expect(severityRank("critical")).toBeGreaterThan(severityRank("warning"));
  });

  it("reads the admin allowlist leniently", () => {
    expect(parseAllowlist('["NTFY.lan", " mail.lan ", 3]')).toEqual([
      "ntfy.lan",
      "mail.lan",
    ]);
    expect(parseAllowlist("not json")).toEqual([]);
    expect(parseAllowlist(null)).toEqual([]);
  });

  it("keeps only a safe tab id and an http(s) url in a link", () => {
    expect(cleanLink({ tab: "docker", url: "https://a.example" })).toEqual({
      tab: "docker",
      url: "https://a.example",
    });
    expect(cleanLink({ tab: "../../x", url: "file:///etc/passwd" })).toBeNull();
    expect(cleanLink("docker")).toBeNull();
  });
});

describe("describeSendError", () => {
  it("explains a blocked private address", () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("Private destinations are not allowed"),
    });
    expect(describeSendError(error)).toMatch(/private network/);
  });

  it("shows the real reason behind fetch failed", () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND nope.invalid"),
    });
    expect(describeSendError(error)).toBe(
      "Could not reach the address: getaddrinfo ENOTFOUND nope.invalid",
    );
    expect(describeSendError(new Error("HTTP 500 Server Error"))).toBe(
      "HTTP 500 Server Error",
    );
  });
});

describe("telegram and webhook templates", () => {
  it("posts a Telegram message to the bot API", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      { type: "telegram", config: { token: "123:abc", chatId: "-100" } },
      ALERT,
      d,
    );
    expect(calls[0].url).toBe(
      "https://api.telegram.org/bot123:abc/sendMessage",
    );
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.chat_id).toBe("-100");
    expect(body.text).toContain("Disk full");
    expect(body.text).toContain("https://termix.example/hosts/1");
  });

  it("checks Telegram settings", () => {
    expect(
      validateChannelConfig("telegram", {
        token: "123:abc",
        chatId: "@ops_team",
      }),
    ).toBeNull();
    expect(
      validateChannelConfig("telegram", { token: "x", chatId: "1" }),
    ).toMatch(/bot token/);
  });

  it("fills a webhook body template with escaped values", async () => {
    const { deps: d, calls } = deps();
    await sendToChannel(
      {
        type: "webhook",
        config: {
          url: "https://chat.example/hooks/x",
          bodyTemplate: '{"text": "{{title}}: {{message}}", "who": "{{nope}}"}',
        },
      },
      { ...ALERT, body: 'say "hi"' },
      d,
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      text: 'Disk full: say "hi"',
      who: "",
    });
  });

  it("refuses a template that is not JSON", () => {
    expect(
      validateChannelConfig("webhook", {
        url: "https://x.example",
        bodyTemplate: "{{title}",
      }),
    ).toMatch(/not valid JSON/);
  });
});
