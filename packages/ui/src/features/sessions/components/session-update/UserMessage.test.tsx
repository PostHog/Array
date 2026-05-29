import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserMessage } from "./UserMessage";

describe("UserMessage", () => {
  it("renders attachment chips for cloud prompts", () => {
    render(
      <Theme>
        <UserMessage
          content="read this file"
          attachments={[
            { id: "attachment://test.txt", label: "test.txt" },
            { id: "attachment://notes.md", label: "notes.md" },
          ]}
        />
      </Theme>,
    );

    expect(screen.getByText("read this file")).toBeInTheDocument();
    expect(screen.getByText("test.txt")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });
});
