import { afterEach, describe, expect, it } from "vitest";
import {
  EXPO_PUSH_URL,
  pushMessage,
  validateChannelConfig,
} from "../../src/backend/senders.js";
import { addChannel, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const TOKEN = "ExponentPushToken[abc123XYZ]";
const PHONE = {
  token: TOKEN,
  platform: "android",
  name: "Pixel",
  accountKey: "acc_1",
};

const ok = () => new Response(JSON.stringify({ data: [{ status: "ok" }] }));

describe("mobile channel config", () => {
  it("needs an Expo token and a platform", () => {
    expect(
      validateChannelConfig("mobile", { token: TOKEN, platform: "ios" }),
    ).toBeNull();
    expect(
      validateChannelConfig("mobile", { token: "abc", platform: "ios" }),
    ).toMatch(/Expo push token/);
    expect(
      validateChannelConfig("mobile", { token: TOKEN, platform: "web" }),
    ).toMatch(/platform/);
  });

  it("builds a push that fits and maps severity", () => {
    const message = pushMessage(
      { token: TOKEN, accountKey: "acc_1" },
      {
        itemId: 7,
        title: "Disk full",
        body: "x".repeat(5000),
        severity: "critical",
        category: "metrics.disk",
        source: "host-metrics",
        link: { tab: "alerts" },
      },
    );
    expect(message).toMatchObject({
      to: TOKEN,
      title: "Disk full",
      priority: "high",
      channelId: "alerts-critical",
      data: { itemId: 7, accountKey: "acc_1", severity: "critical" },
    });
    expect(JSON.stringify(message).length).toBeLessThan(4096);
    expect(
      pushMessage(
        { token: TOKEN },
        { title: "t", body: "", severity: "info", category: "c", source: "s" },
      ),
    ).toMatchObject({ priority: "normal", channelId: "alerts", body: "t" });
  });
});

describe("devices", () => {
  it("links a phone with a channel and a rule, updates and unlinks it", async () => {
    server = await startServer({ respond: ok });
    const put = await server.request("PUT", "/devices/install-0001", {
      body: { ...PHONE, minSeverity: "critical" },
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      installId: "install-0001",
      name: "Pixel",
      platform: "android",
      enabled: true,
      minSeverity: "critical",
    });

    const channels = (await server.request("GET", "/channels")).body;
    expect(channels).toEqual([
      expect.objectContaining({ type: "mobile", name: "Pixel" }),
    ]);
    const rules = (await server.request("GET", "/rules")).body;
    expect(rules).toEqual([
      expect.objectContaining({
        name: "Mobile: Pixel",
        match: "*",
        minSeverity: "critical",
        channelIds: [put.body.channelId],
      }),
    ]);

    // The token never goes back to the browser.
    const detail = await server.request(
      "GET",
      `/channels/${put.body.channelId}`,
    );
    expect(JSON.stringify(detail.body)).not.toContain("abc123");
    const devices = await server.request("GET", "/devices");
    expect(devices.body).toHaveLength(1);
    expect(JSON.stringify(devices.body)).not.toContain("abc123");

    // Linking again updates the same channel and rule, keeping its pattern.
    await server.request("PUT", `/rules/${rules[0].id}`, {
      body: { ...rules[0], match: "docker.*" },
    });
    await server.request("PUT", "/devices/install-0001", {
      body: { ...PHONE, minSeverity: "warning", enabled: false },
    });
    expect((await server.request("GET", "/channels")).body).toHaveLength(1);
    expect((await server.request("GET", "/rules")).body).toEqual([
      expect.objectContaining({ match: "docker.*", minSeverity: "warning" }),
    ]);
    expect((await server.request("GET", "/devices")).body[0]).toMatchObject({
      enabled: false,
      minSeverity: "warning",
    });

    expect(
      (await server.request("DELETE", "/devices/install-0001")).status,
    ).toBe(200);
    expect((await server.request("GET", "/channels")).body).toEqual([]);
    expect((await server.request("GET", "/rules")).body).toEqual([]);
  });

  it("refuses bad input", async () => {
    server = await startServer();
    for (const [path, body] of [
      ["/devices/short", PHONE],
      ["/devices/install-0001", { ...PHONE, token: "nope" }],
      ["/devices/install-0001", { ...PHONE, platform: "web" }],
    ] as const) {
      const response = await server.request("PUT", path, { body });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("keeps each user's phones to themselves", async () => {
    server = await startServer();
    await server.request("PUT", "/devices/install-0001", { body: PHONE });
    expect(
      (await server.request("GET", "/devices", { user: "bob" })).body,
    ).toEqual([]);
    expect(
      (
        await server.request("DELETE", "/devices/install-0001", {
          user: "bob",
        })
      ).status,
    ).toBe(404);
    // Bob linking the same install id gets his own channel.
    await server.request("PUT", "/devices/install-0001", {
      user: "bob",
      body: PHONE,
    });
    expect((await server.request("GET", "/channels")).body).toHaveLength(1);
    expect(
      (await server.request("GET", "/channels", { user: "bob" })).body,
    ).toHaveLength(1);
  });

  it("only lets the app make mobile channels", async () => {
    server = await startServer();
    const created = await server.request("POST", "/channels", {
      body: { name: "x", type: "mobile", config: { token: TOKEN } },
    });
    expect(created.status).toBe(400);
    const webhook = await addChannel(server, {
      name: "hook",
      type: "webhook",
      config: { url: "https://hooks.example/a" },
    });
    const changed = await server.request("PUT", `/channels/${webhook}`, {
      body: { type: "mobile", config: { token: TOKEN, platform: "ios" } },
    });
    expect(changed.status).toBe(400);
    expect(
      (await server.request("GET", "/meta")).body.channelTypes,
    ).not.toContain("mobile");
  });

  it("keeps one channel and rule when the app links several times at once", async () => {
    server = await startServer();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        server!.request("PUT", "/devices/install-0001", { body: PHONE }),
      ),
    );
    expect((await server.request("GET", "/channels")).body).toHaveLength(1);
    expect((await server.request("GET", "/rules")).body).toHaveLength(1);
  });

  it("removes copies of the phone's rule left by an earlier race", async () => {
    server = await startServer();
    const put = await server.request("PUT", "/devices/install-0001", {
      body: PHONE,
    });
    for (let i = 0; i < 3; i++) {
      await server.request("POST", "/rules", {
        body: {
          name: "Mobile: Pixel",
          match: "*",
          minSeverity: "warning",
          channelIds: [put.body.channelId],
        },
      });
    }
    await server.request("POST", "/rules", {
      body: {
        name: "my own",
        match: "*",
        minSeverity: "info",
        channelIds: [put.body.channelId],
      },
    });
    await server.request("PUT", "/devices/install-0001", { body: PHONE });
    const names = (await server.request("GET", "/rules")).body.map(
      (rule: { name: string }) => rule.name,
    );
    expect(names.sort()).toEqual(["Mobile: Pixel", "my own"]);
  });

  it("deleting the channel on the web removes its rule", async () => {
    server = await startServer();
    const put = await server.request("PUT", "/devices/install-0001", {
      body: PHONE,
    });
    await server.request("DELETE", `/channels/${put.body.channelId}`);
    expect((await server.request("GET", "/rules")).body).toEqual([]);
  });
});

describe("pushing alerts", () => {
  it("sends matching alerts to Expo with the item id", async () => {
    server = await startServer({ respond: ok });
    await server.request("PUT", "/devices/install-0001", { body: PHONE });
    await server.hub.deliver({
      source: "docker",
      recipients: ["alice"],
      notification: {
        title: "Container down",
        body: "web stopped",
        severity: "critical",
        category: "docker.down",
      },
    });
    await server.hub.deliver({
      source: "docker",
      recipients: ["alice"],
      notification: { title: "fyi", severity: "info", category: "docker.x" },
    });
    const pushes = server.fetches.filter((call) => call.url === EXPO_PUSH_URL);
    expect(pushes).toHaveLength(1);
    const [message] = JSON.parse(String(pushes[0].init?.body));
    const items = (await server.request("GET", "/items")).body.items;
    expect(message).toMatchObject({
      to: TOKEN,
      title: "Container down",
      body: "web stopped",
      data: { accountKey: "acc_1", itemId: items[1].id },
    });
  });

  it("turns the channel off when Expo says the phone is gone", async () => {
    server = await startServer({
      respond: () =>
        new Response(
          JSON.stringify({
            data: [
              {
                status: "error",
                message: "not registered",
                details: { error: "DeviceNotRegistered" },
              },
            ],
          }),
        ),
    });
    await server.request("PUT", "/devices/install-0001", { body: PHONE });
    const result = await server.hub.deliver({
      source: "docker",
      recipients: ["alice"],
      notification: { title: "x", severity: "critical", category: "c" },
    });
    expect(result.failures).toHaveLength(1);
    expect((await server.request("GET", "/devices")).body[0].enabled).toBe(
      false,
    );
  });

  it("reports other push errors without turning the channel off", async () => {
    server = await startServer({
      respond: () =>
        new Response(
          JSON.stringify({
            data: [{ status: "error", message: "Message too big" }],
          }),
        ),
    });
    const put = await server.request("PUT", "/devices/install-0001", {
      body: PHONE,
    });
    const test = await server.request(
      "POST",
      `/channels/${put.body.channelId}/test`,
    );
    expect(test.body).toEqual({ success: false, error: "Message too big" });
    expect((await server.request("GET", "/devices")).body[0].enabled).toBe(
      true,
    );
  });
});
