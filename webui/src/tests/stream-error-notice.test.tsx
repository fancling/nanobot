import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StreamErrorNotice } from "@/components/thread/StreamErrorNotice";

describe("StreamErrorNotice", () => {
  it("offers replay when a model request fails after automatic retries", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <StreamErrorNotice
        error={{ kind: "model_failure", chatId: "chat-1" }}
        onDismiss={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Model request failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry previous input" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
