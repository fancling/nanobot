import { describe, expect, it } from "vitest";
import { parseBoard } from "@/lib/board";

import { BOARD_FIXTURE } from "./fixtures/board";


describe("board entries", () => {
  it("extracts heading entries and legacy recorded bullets without counting the overview", () => {
    const entries = parseBoard(BOARD_FIXTURE);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ title: "一起看更多世界。", type: "想一直挂着的", author: "凉子" });
    expect(entries[1]).toMatchObject({ title: "语言学", type: "学习/成长", author: "凉子", updatedAt: "2026-09-01" });
    expect(entries[2]).toMatchObject({ title: "英语", type: "学习/成长", author: "古泉" });
    expect(entries[3].content).toContain("尝试最终 Boss");
  });

  it("keeps unclassified headings and ignores headings inside fenced code", () => {
    const entries = parseBoard("### First\r\n```md\r\n### Not an entry\r\n```\r\n### Second\r\n- Recorder: Alice\r\n- Date: 2026-09-01");
    expect(entries.map((entry) => entry.title)).toEqual(["First", "Second"]);
    expect(entries[0].type).toBe("");
    expect(entries[0].content).toContain("### Not an entry");
    expect(entries[1].author).toBe("Alice");
  });

  it("does not invent entries for unstructured text", () => {
    expect(parseBoard("# Board\n\nSome notes\n- Empty")).toEqual([]);
  });
});
