/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentTiles } from "./AttachmentTiles";

afterEach(cleanup);

describe("AttachmentTiles", () => {
  it("renders pictures without any name text and keeps the remove button named", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <AttachmentTiles
        disabled={false}
        onRemove={onRemove}
        items={[{ key: "a", name: "photo.png", src: "data:image/png;base64,AA==" }]}
      />,
    );
    expect(container.textContent).toBe("");
    expect(container.querySelector(".composer-attachment-name")).toBeNull();
    const tile = container.querySelector(".composer-attachment");
    expect(tile?.getAttribute("title")).toBe("photo.png");
    expect(screen.getByAltText("photo.png").getAttribute("src")).toBe("data:image/png;base64,AA==");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo.png" }));
    expect(onRemove).toHaveBeenCalledWith("a");
  });

  it("shows the name under an icon when there is no preview", () => {
    const { container } = render(
      <AttachmentTiles disabled={false} items={[{ key: "a", name: "photo.png" }]} />,
    );
    expect(container.querySelector(".composer-attachment-name")?.textContent).toBe("photo.png");
    expect(container.querySelector(".composer-attachment-fallback svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove photo.png" })).toBeTruthy();
  });

  it("falls back to the name when the image fails to load", () => {
    const { container } = render(
      <AttachmentTiles disabled={false} items={[{ key: "a", name: "gone.png", src: "tauri://gone.png" }]} />,
    );
    expect(container.querySelector(".composer-attachment-name")).toBeNull();
    fireEvent.error(screen.getByAltText("gone.png"));
    expect(container.querySelector(".composer-attachment-name")?.textContent).toBe("gone.png");
    expect(container.querySelector(".composer-attachment-image")).toBeNull();
  });

  it("disables removal and renders nothing for an empty list", () => {
    const { container, rerender } = render(
      <AttachmentTiles disabled items={[{ key: "a", name: "x.png", src: "data:image/png;base64,AA==" }]} />,
    );
    expect(screen.getByRole("button", { name: "Remove x.png" })).toHaveProperty("disabled", true);
    rerender(<AttachmentTiles disabled={false} items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
