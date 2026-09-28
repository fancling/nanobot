import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContextArchiveStatus } from "@/components/thread/ContextArchiveStatus";

describe("ContextArchiveStatus", () => {
  it("shows replay occupancy and exposes a manual archive action", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    const onExtractMemory = vi.fn();

    render(
      <ContextArchiveStatus
        archiving={false}
        onArchive={onArchive}
        onExtractMemory={onExtractMemory}
        status={{
          needed: false,
          reason: null,
          message_count: 42,
          max_messages: 120,
          estimated_tokens: 12000,
          replay_message_count: 42,
          replay_estimated_tokens: 12000,
          token_budget: 60000,
          available: true,
          keep_recent_messages: 0,
          auto_consolidation_enabled: false,
          memory_extraction_available: true,
        }}
      />,
    );

    const status = screen.getByRole("region", { name: "Context usage" });
    expect(status).toHaveClass("mx-auto", "w-full", "max-w-[49.5rem]");
    expect(status).toHaveTextContent("42 / 120 messages");
    expect(status).toHaveTextContent("12K / 60K tokens");
    expect(screen.getByRole("progressbar", { name: "Context usage" })).toHaveAttribute(
      "aria-valuenow",
      "35",
    );
    await user.click(screen.getByRole("button", { name: "Archive conversation" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Extract to Mem0" }));
    expect(onExtractMemory).toHaveBeenCalledTimes(1);
  });

  it("matches the wider empty-state composer", () => {
    render(
      <ContextArchiveStatus
        archiving={false}
        onArchive={vi.fn()}
        variant="hero"
        status={{
          needed: false,
          reason: null,
          message_count: 0,
          max_messages: 120,
          estimated_tokens: 0,
          replay_message_count: 0,
          replay_estimated_tokens: 0,
          token_budget: 60000,
          available: true,
          keep_recent_messages: 0,
          auto_consolidation_enabled: false,
          memory_extraction_available: false,
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "Context usage" })).toHaveClass(
      "max-w-[58rem]",
    );
  });
});
