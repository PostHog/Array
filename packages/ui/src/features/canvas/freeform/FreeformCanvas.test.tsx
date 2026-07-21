import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FreeformCanvas } from "./FreeformCanvas";

describe("FreeformCanvas", () => {
  it("does not grant the sandbox popup permission", () => {
    render(
      <FreeformCanvas
        code="export default function Canvas() { return null }"
        mode="edit"
        onDataRequest={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Canvas")).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
  });
});
