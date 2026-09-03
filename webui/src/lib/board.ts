export interface BoardEntry {
  id: string;
  title: string;
  type: string;
  author: string;
  updatedAt: string;
  section: string;
  content: string;
}

/** Keep the original Markdown for editing; derive a view of its recorded entries. */
export function parseBoard(source: string): BoardEntry[] {
  const entries: BoardEntry[] = [];
  let section = "";
  let candidate: { title: string; lines: string[]; heading: boolean; line: number } | null = null;
  let fence = "";

  const flush = () => {
    if (!candidate) return;
    const content = candidate.lines.join("\n").trim();
    const metadata = (labels: string) => {
      const match = content.match(new RegExp(
        `^\\s*(?:[-*+]\\s+)?(?:\\*\\*)?(?:${labels})(?:\\*\\*)?\\s*[:：]\\s*(.+)$`, "mi",
      ));
      return match?.[1].trim() ?? "";
    };
    const author = metadata("记录者|作者|Recorder|Author");
    const updatedAt = metadata("最近更新时间|更新时间|时间|Updated(?: at)?|Date");
    // Older board sections use top-level bullets with indented record metadata.
    // Overview instructions and empty placeholders aren't records.
    const recordedBullet = /^\s{2,}[-*+]\s+(?:\*\*)?(?:记录者|作者|Recorder|Author)/mi.test(content);
    if (candidate.heading || recordedBullet) {
      entries.push({
        id: `board-${candidate.line}`,
        title: candidate.title.replace(/\*\*|`/g, "").trim(),
        type: metadata("类型|Type") || section,
        author,
        updatedAt,
        section,
        content,
      });
    }
    candidate = null;
  };

  source.replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
      candidate?.lines.push(line);
      return;
    }
    if (fence) {
      candidate?.lines.push(line);
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading) {
      flush();
      if (heading[1].length <= 2) section = heading[2];
      else candidate = { title: heading[2], lines: [], heading: true, line: index };
      return;
    }
    if (/^(?:---+|\*\*\*+|___+)\s*$/.test(line) && !candidate?.heading) {
      flush();
      return;
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet && !candidate?.heading) {
      flush();
      candidate = { title: bullet[1], lines: [line], heading: false, line: index };
      return;
    }
    candidate?.lines.push(line);
  });
  flush();
  return entries;
}
