import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SessionOperationNotice } from "@/components/thread/SessionOperationNotice";

describe("SessionOperationNotice", () => {
  it("matches the thread composer width and exposes the result", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <SessionOperationNotice
        message="Archived 42 messages to history.jsonl. The original session JSONL was preserved."
        dismissLabel="Dismiss result"
        onDismiss={onDismiss}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveClass("mx-auto", "w-full", "max-w-[49.5rem]");
    expect(notice).toHaveTextContent(
      "Archived 42 messages to history.jsonl",
    );
    expect(notice).toHaveTextContent(
      "original session JSONL was preserved",
    );
    await user.click(screen.getByRole("button", { name: "Dismiss result" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses the same card and hero composer width for errors", () => {
    render(
      <SessionOperationNotice
        message="Could not extract this conversation to Mem0."
        dismissLabel="Dismiss result"
        onDismiss={vi.fn()}
        tone="error"
        variant="hero"
      />,
    );

    expect(screen.getByRole("alert")).toHaveClass("w-full", "max-w-[58rem]");
  });
});
