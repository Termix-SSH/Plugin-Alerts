import { describe, expect, it } from "vitest";
import {
  isLive,
  parseAnnouncement,
  parseDuration,
} from "../../src/announcements-schema.js";
import { parseTimestamp, reaches } from "../../src/backend/announcements.js";

const base = { id: "hello", title: "Hello", date: "2026-10-10" };
const link = { label: "x", url: "https://a.b" };

function errors(raw: unknown): string {
  return parseAnnouncement(raw).errors.join("\n");
}

describe("parseAnnouncement", () => {
  it("fills in defaults", () => {
    expect(parseAnnouncement(base)).toEqual({
      errors: [],
      announcement: {
        id: "hello",
        title: "Hello",
        body: "",
        severity: "info",
        date: "2026-10-10T00:00:00.000Z",
        expires: null,
        newUsers: false,
        audience: "everyone",
        display: "inbox",
        actions: [],
      },
    });
  });

  it("counts a duration expiry from the date", () => {
    const result = parseAnnouncement({ ...base, expires: "2w" });
    expect(result.announcement?.expires).toBe("2026-10-24T00:00:00.000Z");
    const absolute = parseAnnouncement({ ...base, expires: "2026-11-01" });
    expect(absolute.announcement?.expires).toBe("2026-11-01T00:00:00.000Z");
  });

  it("keeps url and tab actions in order", () => {
    const result = parseAnnouncement({
      ...base,
      actions: [
        { label: " Docs ", url: "https://docs.termix.site" },
        { label: "Settings", tab: "settings" },
      ],
    });
    expect(result.announcement?.actions).toEqual([
      { label: "Docs", url: "https://docs.termix.site" },
      { label: "Settings", tab: "settings" },
    ]);
  });

  it.each([
    [{ ...base, id: "Has Spaces" }, "id must be"],
    [{ ...base, title: "" }, "title is required"],
    [{ ...base, severity: "loud" }, "severity must be"],
    [{ ...base, audience: "friends" }, "audience must be"],
    [{ ...base, display: "banner" }, "display must be"],
    [{ ...base, date: "soon" }, "date must be"],
    [{ ...base, expires: "forever" }, "expires must be"],
    [{ ...base, expires: "2026-10-01" }, "expires must be after date"],
    [{ ...base, newUsers: "yes" }, "newUsers must be"],
    [{ ...base, colour: "red" }, 'unknown key "colour"'],
    [{ ...base, actions: "nope" }, "actions must be a list"],
    [
      { ...base, actions: [{ ...link, tab: "settings" }] },
      "either a url or a tab",
    ],
    [{ ...base, actions: [{ label: "None" }] }, "either a url or a tab"],
    [
      { ...base, actions: [{ label: "Bad", url: "javascript:alert(1)" }] },
      "url must start",
    ],
    [{ ...base, actions: [{ url: "https://a.b" }] }, "needs a label"],
    [{ ...base, actions: [{ ...link, extra: 1 }] }, 'unknown key "extra"'],
    [{ ...base, actions: Array(5).fill(link) }, "at most 4 actions"],
  ])("refuses %j", (raw, message) => {
    expect(errors(raw)).toContain(message);
  });
});

describe("parseDuration", () => {
  it("reads hours, days and weeks", () => {
    expect(parseDuration("12h")).toBe(12 * 3_600_000);
    expect(parseDuration("7d")).toBe(7 * 86_400_000);
    expect(parseDuration("2W")).toBe(14 * 86_400_000);
    expect(parseDuration("0d")).toBeNull();
    expect(parseDuration("3m")).toBeNull();
  });
});

describe("isLive", () => {
  it("waits for the date and stops at expiry", () => {
    const result = parseAnnouncement({ ...base, expires: "1d" });
    const entry = result.announcement!;
    expect(isLive(entry, Date.parse("2026-10-09"))).toBe(false);
    expect(isLive(entry, Date.parse("2026-10-10T12:00:00Z"))).toBe(true);
    expect(isLive(entry, Date.parse("2026-10-11"))).toBe(false);
  });
});

describe("reaches", () => {
  const result = parseAnnouncement(base);
  const entry = result.announcement!;
  const before = Date.parse("2026-10-01");
  const after = Date.parse("2026-10-20");

  it("goes to users who signed up before it, or anyone when newUsers is set", () => {
    expect(reaches(entry, { registeredAt: before, isAdmin: false })).toBe(true);
    expect(reaches(entry, { registeredAt: after, isAdmin: false })).toBe(false);
    expect(
      reaches(
        { ...entry, newUsers: true },
        { registeredAt: after, isAdmin: false },
      ),
    ).toBe(true);
    expect(reaches(entry, { registeredAt: null, isAdmin: false })).toBe(true);
  });

  it("keeps admin ones from everyone else", () => {
    const admins = { ...entry, audience: "admins" as const };
    expect(reaches(admins, { registeredAt: before, isAdmin: true })).toBe(true);
    expect(reaches(admins, { registeredAt: before, isAdmin: false })).toBe(
      false,
    );
    expect(reaches(admins, null)).toBe(false);
    expect(reaches(entry, null)).toBe(true);
  });
});

describe("parseTimestamp", () => {
  it("reads SQLite timestamps as UTC", () => {
    expect(parseTimestamp("2026-10-01 12:00:00")).toBe(
      Date.parse("2026-10-01T12:00:00Z"),
    );
    expect(parseTimestamp("2026-10-01T12:00:00+02:00")).toBe(
      Date.parse("2026-10-01T10:00:00Z"),
    );
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp("nope")).toBeNull();
  });
});
