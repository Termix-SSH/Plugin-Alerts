import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "../../src/frontend/markdown";

const html = (text: string) =>
  render(<Markdown text={text} />).container.innerHTML;

describe("Markdown", () => {
  it("renders inline styles and links", () => {
    const { container } = render(
      <Markdown text="Some **bold**, *italic*, _also_ and `code`. See [the docs](https://docs.termix.site) or https://termix.site." />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(
      [...container.querySelectorAll("em")].map((node) => node.textContent),
    ).toEqual(["italic", "also"]);
    expect(container.querySelector("code")?.textContent).toBe("code");
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://docs.termix.site",
      "https://termix.site",
    ]);
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(container.textContent).toContain("https://termix.site.");
  });

  it("renders headings, lists and paragraphs", () => {
    const { container } = render(
      <Markdown
        text={
          "# Title\n\nFirst line\nsame paragraph\n\n- one\n- two\n\n1. first\n2. second"
        }
      />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("p")?.textContent).toBe("Title");
    expect(container.querySelectorAll("p")[1].textContent).toBe(
      "First line same paragraph",
    );
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("never turns text into HTML or unsafe links", () => {
    const out = html(
      '<img src=x onerror="alert(1)"> [click](javascript:alert(1)) <script>bad()</script>',
    );
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("&lt;img");
    expect(out).toContain("click");
  });
});
