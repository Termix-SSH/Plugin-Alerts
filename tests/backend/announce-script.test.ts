import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFeed,
  createAnnouncement,
  idFromFile,
  parseFile,
  serializeFeed,
  slugify,
} from "../../scripts/announce.ts";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "announce-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, text: string) =>
  fs.writeFileSync(path.join(dir, name), text);

describe("the announce script", () => {
  it("names files and ids from the title", () => {
    expect(slugify("Termix 26.10 is out!")).toBe("termix-26-10-is-out");
    expect(slugify("!!!")).toBe("announcement");
    expect(idFromFile("2026-10-10-termix-is-out.md")).toBe("termix-is-out");
  });

  it("writes a new file that builds as is", () => {
    const now = new Date("2026-10-10T15:00:00Z");
    const file = createAnnouncement(dir, "Big news", now);
    expect(path.basename(file)).toBe("2026-10-10-big-news.md");
    expect(path.basename(createAnnouncement(dir, "Big news", now))).toBe(
      "2026-10-10-big-news-2.md",
    );

    const { feed, errors } = buildFeed(dir);
    expect(errors).toEqual([]);
    expect(feed.find((entry) => entry.id === "big-news")).toMatchObject({
      title: "Big news",
      date: "2026-10-10T15:00:00.000Z",
      actions: [{ label: "Learn more", url: "https://termix.site" }],
    });
  });

  it("reads frontmatter and the Markdown body, with Windows line endings", () => {
    const result = parseFile(
      "2026-10-10-hello.md",
      "---\r\ntitle: Hello\r\ndate: 2026-10-10\r\nexpires: 7d\r\n---\r\n\r\nSome **text**.\r\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.announcement).toMatchObject({
      id: "hello",
      body: "Some **text**.",
      expires: "2026-10-17T00:00:00.000Z",
    });
  });

  it("reports bad files by name and duplicate ids, newest first", () => {
    write("2026-10-01-a.md", "---\ntitle: A\ndate: 2026-10-01\n---\nA");
    write("2026-10-05-b.md", "---\ntitle: B\ndate: 2026-10-05\n---\nB");
    write(
      "2026-10-06-dupe.md",
      "---\nid: a\ntitle: C\ndate: 2026-10-06\n---\n",
    );
    write("2026-10-07-bad.md", "---\ntitle: D\nseverity: loud\n---\n");
    write("2026-10-08-none.md", "no frontmatter");
    write("README.md", "ignored");

    const { feed, errors } = buildFeed(dir);
    const report = errors.join("\n");
    expect(feed.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(report).toContain('2026-10-06-dupe.md: id "a" is already used');
    expect(report).toContain("2026-10-07-bad.md: severity must be");
    expect(report).toContain("2026-10-08-none.md: missing the ---");
  });

  it("has a committed feed that matches the files", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const { feed, errors } = buildFeed(path.join(root, "announcements"));
    expect(errors).toEqual([]);
    const committed = fs
      .readFileSync(path.join(root, "announcements.json"), "utf8")
      .replace(/\r\n/g, "\n");
    expect(committed).toBe(serializeFeed(feed));
  });
});
