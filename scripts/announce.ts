/**
 * Termix announcements, written as Markdown in announcements/.
 *
 *   npm run announce -- "Title"   new file with today's date
 *   npm run announce:build        validate and write announcements.json
 *   npm run announce:check        fail if a file is invalid or the json is stale
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  parseAnnouncement,
  type Announcement,
} from "../src/announcements-schema.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_DIR = path.join(ROOT, "announcements");
export const FEED_FILE = path.join(ROOT, "announcements.json");

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "announcement"
  );
}

/** The id a file gets when its frontmatter has none. */
export function idFromFile(file: string): string {
  return path.basename(file, ".md").replace(DATE_PREFIX, "");
}

export function parseFile(
  file: string,
  text: string,
): { announcement?: Announcement; errors: string[] } {
  const match = FRONTMATTER.exec(text.replace(/\r\n/g, "\n"));
  if (!match) return { errors: ["missing the --- frontmatter block"] };
  let data: unknown;
  try {
    data = parseYaml(match[1]);
  } catch (error) {
    return {
      errors: [
        `frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["frontmatter must be a list of key: value lines"] };
  }
  const result = parseAnnouncement({
    id: idFromFile(file),
    ...(data as Record<string, unknown>),
    body: match[2],
  });
  return result;
}

export function buildFeed(dir: string): {
  feed: Announcement[];
  errors: string[];
} {
  const feed: Announcement[] = [];
  const errors: string[] = [];
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".md") && file !== "README.md")
        .sort()
    : [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const result = parseFile(
      file,
      fs.readFileSync(path.join(dir, file), "utf8"),
    );
    for (const error of result.errors) errors.push(`${file}: ${error}`);
    if (!result.announcement) continue;
    const other = seen.get(result.announcement.id);
    if (other) {
      errors.push(
        `${file}: id "${result.announcement.id}" is already used by ${other}`,
      );
      continue;
    }
    seen.set(result.announcement.id, file);
    feed.push(result.announcement);
  }
  feed.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { feed, errors };
}

export function serializeFeed(feed: Announcement[]): string {
  return `${JSON.stringify(feed, null, 2)}\n`;
}

export function template(title: string, now: Date): string {
  const quoted = JSON.stringify(title);
  return `---
title: ${quoted}
# info, success, warning or critical
severity: info
# When it goes live. A future date waits until then.
date: ${now.toISOString().replace(/\.\d{3}Z$/, "Z")}
# Optional. A date, or how long after date: 12h, 7d, 2w
# expires: 2w
# Users who sign up after date only get it when this is true.
newUsers: false
# everyone or admins
audience: everyone
# inbox, or popup to also show it as a card on screen when it arrives
display: inbox
# Up to 4 buttons, each with a url or a Termix tab id.
actions:
  - label: Learn more
    url: https://termix.site
---

Write the announcement here. **Bold**, *italic*, \`code\`, [links](https://termix.site) and lists work.
`;
}

/** Writes a new announcement file and returns its path. */
export function createAnnouncement(
  dir: string,
  title: string,
  now = new Date(),
): string {
  const day = now.toISOString().slice(0, 10);
  const slug = slugify(title);
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `${day}-${slug}.md`);
  for (let n = 2; fs.existsSync(file); n += 1) {
    file = path.join(dir, `${day}-${slug}-${n}.md`);
  }
  fs.writeFileSync(file, template(title, now));
  return file;
}

function fail(errors: string[]): never {
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

function main(args: string[]) {
  const [command, ...rest] = args;
  if (command === "new") {
    const title = rest.join(" ").trim();
    if (!title) fail(['Give it a title: npm run announce -- "My title"']);
    const file = createAnnouncement(SOURCE_DIR, title);
    console.log(`Created ${path.relative(ROOT, file)}`);
    console.log("Edit it, then run npm run announce:build");
    return;
  }
  if (command === "build" || command === "check") {
    const { feed, errors } = buildFeed(SOURCE_DIR);
    if (errors.length > 0) {
      console.error("Announcements have problems:");
      fail(errors);
    }
    const text = serializeFeed(feed);
    if (command === "build") {
      fs.writeFileSync(FEED_FILE, text);
      console.log(`Wrote ${feed.length} announcement(s) to announcements.json`);
      return;
    }
    const current = fs.existsSync(FEED_FILE)
      ? fs.readFileSync(FEED_FILE, "utf8").replace(/\r\n/g, "\n")
      : "";
    if (current !== text) {
      fail(["announcements.json is out of date. Run npm run announce:build"]);
    }
    console.log(`announcements.json is up to date (${feed.length})`);
    return;
  }
  fail(["Use: new <title>, build or check"]);
}

if (import.meta.main) main(process.argv.slice(2));
