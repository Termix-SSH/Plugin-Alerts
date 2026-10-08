import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AnnouncementCard } from "../../src/frontend/AlertToaster";
import type { AlertItem } from "../../src/types";

const item: AlertItem = {
  id: 7,
  source: "termix",
  category: "termix.announcement",
  severity: "warning",
  title: "Security update",
  body: "Update **now**.",
  link: null,
  context: {
    announcementId: "security",
    display: "popup",
    actions: [
      { label: "Release notes", url: "https://termix.site/notes" },
      { label: "Updates", tab: "settings" },
    ],
  },
  deliveries: null,
  readAt: null,
  createdAt: "2026-10-10T00:00:00.000Z",
};

function renderCard() {
  const props = {
    openTab: vi.fn(),
    onClose: vi.fn(),
    onView: vi.fn(),
  };
  render(
    <AnnouncementCard
      item={item}
      labels={{ close: "Close", view: "View in inbox" }}
      {...props}
    />,
  );
  return props;
}

describe("the announcement popup card", () => {
  it("shows the title, body and every button", () => {
    renderCard();
    expect(screen.getByText("Security update")).toBeTruthy();
    expect(screen.getByText("now").tagName).toBe("STRONG");
    expect(
      screen.getByRole("link", { name: /Release notes/ }).getAttribute("href"),
    ).toBe("https://termix.site/notes");
  });

  it("opens a tab from a button and closes", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    expect(props.openTab).toHaveBeenCalledWith("settings");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("closes and opens the inbox", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View in inbox" }));
    expect(props.onView).toHaveBeenCalled();
  });
});
