# Reader Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Reader right rail with a book-scoped chat stream that sends messages with the active reading snapshot.

**Architecture:** `ReaderPage` loads active book session history via `useSessionHistory` and passes messages into `ReaderMode`. `ReaderMode` renders a reader-specific `ReaderChatPanel` that uses `ThreadMessages` for the transcript and a compact composer for snapshot-aware sends.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Nanobot WebUI session hooks and reader snapshot utilities.

---

### Task 1: Reader Chat Panel

**Files:**
- Create: `webui/src/components/thread/reader/ReaderChatPanel.tsx`
- Modify: `webui/src/components/thread/reader/ReaderMode.tsx`
- Test: `webui/src/tests/reader-mode.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add tests that render `ReaderMode` with sample messages, assert the right panel is named `Reader chat`, assert old note/question labels are absent, and send a reader chat message that includes active paragraph and selected text in the snapshot.

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/tests/reader-mode.test.tsx`

Expected: tests fail because `ReaderChatPanel` does not exist and `ReaderMode` still renders the old companion rail.

- [ ] **Step 3: Implement minimal panel**

Create `ReaderChatPanel` with props for `state`, `messages`, `loading`, `isStreaming`, `disabled`, `persistenceFailed`, `onChange`, `onClose`, and `onSendReading`. Use `ThreadMessages` for messages and a textarea plus send button for composing. Build snapshots with `buildReadingSnapshot`.

- [ ] **Step 4: Wire ReaderMode**

Replace `ReaderCompanionRail` with `ReaderChatPanel`. Pass active section state, messages, loading, and streaming props through from `ReaderMode`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run src/tests/reader-mode.test.tsx`

Expected: all reader mode tests pass after updating old expectations from companion rail to chat panel.

- [ ] **Step 6: Commit**

Run: `git add webui/src/components/thread/reader/ReaderChatPanel.tsx webui/src/components/thread/reader/ReaderMode.tsx webui/src/tests/reader-mode.test.tsx && git commit -m "feat(webui): add reader chat panel"`

### Task 2: Reader Page Session History

**Files:**
- Modify: `webui/src/components/reader/ReaderPage.tsx`
- Modify: `webui/src/App.tsx`
- Test: `webui/src/tests/reader-page.test.tsx`
- Test: `webui/src/tests/app-layout.test.tsx`

- [ ] **Step 1: Write the failing tests**

Update `ReaderPage` tests to pass a reader session key and mock session history messages. Update app layout tests to verify reader page chat sends through the active book session with `readingSnapshot`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run src/tests/reader-page.test.tsx src/tests/app-layout.test.tsx`

Expected: tests fail because `ReaderPage` does not yet accept or load chat messages for `ReaderMode`.

- [ ] **Step 3: Implement history wiring**

Add `sessionKey` to `ReaderPage` props. Inside `ReaderPage`, call `useSessionHistory(sessionKey)`, project messages with existing display compatibility helpers as needed, and pass `messages`, `loading`, and `isStreaming` into `ReaderMode`.

- [ ] **Step 4: Wire App**

Pass `activeSession?.key ?? null` into `ReaderPage` when rendering the reader route.

- [ ] **Step 5: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run src/tests/reader-page.test.tsx src/tests/app-layout.test.tsx`

Expected: updated reader page and app layout tests pass.

- [ ] **Step 6: Commit**

Run: `git add webui/src/components/reader/ReaderPage.tsx webui/src/App.tsx webui/src/tests/reader-page.test.tsx webui/src/tests/app-layout.test.tsx && git commit -m "feat(webui): show book chat in reader"`

### Task 3: Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused reader tests**

Run: `./node_modules/.bin/vitest run src/tests/reader-mode.test.tsx src/tests/reader-page.test.tsx src/tests/app-layout.test.tsx`

Expected: all tests pass.

- [ ] **Step 2: Run existing reader regression tests**

Run: `./node_modules/.bin/vitest run src/tests/reading.test.ts src/tests/chat-list.test.tsx src/tests/thread-shell.test.tsx src/tests/useSessions.test.tsx`

Expected: all tests pass.

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc -p tsconfig.build.json --noEmit`

Expected: command exits 0.

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: command exits 0.

- [ ] **Step 5: Commit fixes if needed**

If verification required code changes, commit only those files with a focused message.
