import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CompactResultNotice } from "@/components/thread/CompactResultNotice";

describe("CompactResultNotice", () => {
  it("makes the history write and preserved session visible", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <CompactResultNotice
        consolidatedMessages={42}
        historyWritten
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Archived 42 messages to history.jsonl",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "original session JSONL was preserved",
    );
    await user.click(screen.getByRole("button", { name: "Dismiss compact result" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
