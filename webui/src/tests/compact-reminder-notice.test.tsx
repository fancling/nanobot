import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CompactReminderNotice } from "@/components/thread/CompactReminderNotice";

describe("CompactReminderNotice", () => {
  it("offers explicit compact and snooze actions", async () => {
    const user = userEvent.setup();
    const onCompact = vi.fn();
    const onSnooze = vi.fn();

    render(
      <CompactReminderNotice
        compacting={false}
        onCompact={onCompact}
        onSnooze={onSnooze}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("conversation reached");
    await user.click(screen.getByRole("button", { name: "Compact now" }));
    await user.click(screen.getByRole("button", { name: "Remind me later" }));
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(onSnooze).toHaveBeenCalledTimes(1);
  });
});
