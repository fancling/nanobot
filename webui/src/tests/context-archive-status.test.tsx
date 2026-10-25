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
          max_messages: null,
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
    expect(status).toHaveTextContent("42 messages");
    expect(status).not.toHaveTextContent("/ 120");
    expect(status).not.toHaveTextContent("∞");
    expect(status).toHaveTextContent("12K / 60K tokens");
    expect(screen.getByRole("progressbar", { name: "Context usage" })).toHaveAttribute(
      "aria-valuenow",
      "20",
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
          max_messages: null,
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

  it("shows more than 120 messages without filling the token progress bar", () => {
    render(
      <ContextArchiveStatus
        archiving={false}
        onArchive={vi.fn()}
        status={{
          needed: false,
          reason: null,
          message_count: 200,
          max_messages: null,
          estimated_tokens: 40000,
          replay_message_count: 200,
          replay_estimated_tokens: 40000,
          token_budget: 128000,
          available: true,
        }}
      />,
    );

    const status = screen.getByRole("region", { name: "Context usage" });
    expect(status).toHaveTextContent("200 messages");
    expect(status).not.toHaveTextContent("/ 120");
    expect(screen.getByRole("progressbar", { name: "Context usage" })).toHaveAttribute(
      "aria-valuenow",
      "31",
    );
  });
});
