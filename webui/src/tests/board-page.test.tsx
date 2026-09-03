import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BoardPage } from "@/components/BoardPage";
import { ApiError, fetchBoard } from "@/lib/api";
import { ClientProvider } from "@/providers/ClientProvider";
import type { NanobotClient } from "@/lib/nanobot-client";
import { BOARD_FIXTURE } from "./fixtures/board";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  fetchBoard: vi.fn(),
}));

const saveBoard = vi.fn();
const client = { saveBoard } as unknown as NanobotClient;
const payload = { content: BOARD_FIXTURE, revision: "revision-1", exists: true };

function page(active = true) {
  return <ClientProvider client={client} token="test-token"><BoardPage active={active} onBackToChat={() => {}} /></ClientProvider>;
}

beforeEach(() => {
  vi.mocked(fetchBoard).mockReset().mockResolvedValue(payload);
  saveBoard.mockReset();
});

describe("BoardPage", () => {
  it("shows totals, type distribution, table and clickable details; editor starts at the bottom", async () => {
    render(page());
    expect(await screen.findByTestId("board-total")).toHaveTextContent("4");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Type", "Content", "Recorder", "Last updated"]);
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("音系学课程")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "学习/成长 2" }));
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "语言学" }));
    const detail = await screen.findByRole("dialog");
    expect(await within(detail).findByText(/音系学课程/)).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "Close" }));
    const edit = screen.getByRole("button", { name: "Edit board" });
    expect(table.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("saves the complete source with its revision and refreshes the summary", async () => {
    render(page());
    fireEvent.click(await screen.findByRole("button", { name: "Edit board" }));
    const content = "## Work\n### New entry\n- Recorder: Alice\n- Type: Learning\n- Date: 2026-09-02\n";
    saveBoard.mockResolvedValue({ content, revision: "revision-2", exists: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Board Markdown" }), { target: { value: content } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saveBoard).toHaveBeenCalledWith(content, "revision-1", "test-token"));
    expect(await screen.findByRole("button", { name: "New entry" })).toBeInTheDocument();
    expect(screen.getByTestId("board-total")).toHaveTextContent("1");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("preserves edits across navigation and refuses to hide a failed or conflicting save", async () => {
    const { rerender } = render(page());
    fireEvent.click(await screen.findByRole("button", { name: "Edit board" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "### Unsaved" } });
    rerender(page(false));
    rerender(page());
    expect(screen.getByRole("textbox")).toHaveValue("### Unsaved");
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    saveBoard.mockRejectedValue(new ApiError(409, "conflict"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
    expect(screen.getByRole("textbox")).toHaveValue("### Unsaved");
    saveBoard.mockRejectedValue(new Error("socket closed"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save"));
    expect(screen.getByRole("textbox")).toHaveValue("### Unsaved");
    expect(screen.getByTestId("board-total")).toHaveTextContent("4");
  });

  it("confirms discarding edits and reloads external changes", async () => {
    render(page());
    fireEvent.click(await screen.findByRole("button", { name: "Edit board" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "### Unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    vi.mocked(fetchBoard).mockResolvedValue({ ...payload, content: "### External change", revision: "new" });
    fireEvent.click(screen.getByRole("button", { name: "Discard and reload" }));
    expect(await screen.findByRole("button", { name: "External change" })).toBeInTheDocument();
    expect(saveBoard).not.toHaveBeenCalled();
  });

  it("supports creating a missing board and retrying a failed load", async () => {
    vi.mocked(fetchBoard).mockRejectedValueOnce(new Error("offline"));
    render(page());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
    vi.mocked(fetchBoard).mockResolvedValue({ content: "", revision: null, exists: false });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Your board is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit board" }));
    const content = "### First entry";
    saveBoard.mockResolvedValue({ content, revision: "created", exists: true });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: content } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saveBoard).toHaveBeenCalledWith(content, null, "test-token"));
    expect(await screen.findByRole("button", { name: "First entry" })).toBeInTheDocument();
  });
});
