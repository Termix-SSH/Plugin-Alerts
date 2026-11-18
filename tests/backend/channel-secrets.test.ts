import { describe, expect, it } from "vitest";
import { maskConfig, mergeConfig } from "../../src/backend/channel-secrets.js";

describe("channel secrets", () => {
  it("leaves webhook URLs and header values out", () => {
    const masked = maskConfig("webhook", {
      url: "https://hooks.example.com/T000/secret",
      method: "POST",
      headers: { Authorization: "Bearer abc" },
    });
    expect(masked.config).toEqual({
      method: "POST",
      headers: { Authorization: "" },
    });
    expect(masked.saved).toEqual(["url"]);
    expect(masked.hints).toEqual({ url: "https://hooks.example.com" });
    expect(JSON.stringify(masked)).not.toContain("secret");
    expect(JSON.stringify(masked)).not.toContain("abc");
  });

  it("leaves Telegram and ntfy tokens out", () => {
    expect(maskConfig("telegram", { token: "1:x", chatId: "5" })).toEqual({
      config: { chatId: "5" },
      saved: ["token"],
      hints: {},
    });
    expect(maskConfig("ntfy", { url: "https://ntfy.sh", topic: "a" })).toEqual({
      config: { url: "https://ntfy.sh", topic: "a" },
      saved: [],
      hints: {},
    });
  });

  it("keeps saved secrets sent back empty", () => {
    const saved = {
      url: "https://hooks.example.com/secret",
      headers: { Authorization: "Bearer abc", X: "1" },
    };
    expect(
      mergeConfig(
        "webhook",
        { url: "", method: "PUT", headers: { Authorization: "", X: "2" } },
        "webhook",
        saved,
      ),
    ).toEqual({
      url: "https://hooks.example.com/secret",
      method: "PUT",
      headers: { Authorization: "Bearer abc", X: "2" },
    });
  });

  it("never carries secrets over to another channel type", () => {
    expect(
      mergeConfig("discord", { url: "" }, "webhook", {
        url: "https://hooks.example.com/secret",
      }),
    ).toEqual({ url: "" });
  });
});
