# Page: Questions (`/runs/:id`, status `awaiting_answers`)

Direction B: **one Question per screen.** Mockup board: "B · Questions (one at a time)".

## Purpose
Ask about up to 5 must-have Requirements the CV leaves unmet or partially met. Answers become User Evidence; "No" makes a Confirmed Gap. They're asked once, so the screen makes clear that honesty is fine and nothing is invented.

## Layout
- One centred column, 640px max.
- **Top:** segmented progress dots, one per Question: done in `--ok`, current in `--accent`, upcoming in `--line`. Beside them, "Question 2 of 3".
- **The eyebrow:** "A must-have your CV doesn't clearly show". The `awaiting_answers` view has no Requirement text, only `questions`, so the eyebrow can't name the Requirement.
- **The title:** the Question `text`, at 30px.
- **The lead:** "A sentence or two is enough. Saying no is fine: we won't claim it."
- **Two option tiles** (one radio group, nothing preselected):
  - "Yes, I've done this" / "Describe it below", key **1**;
  - "No, I haven't" / "It stays a gap", key **2**.
- **On Yes,** a textarea appears below with the label "What did you build, and with what?" and a counter "0 / 1,000". It gets the focus.
- **Footer:**
  - "‹ Back" (a ghost button, hidden on the first Question);
  - "Next question" (primary), with a ⌘ Enter hint. On the last Question it becomes **"Start tailoring"**.

## Rules
- **Next** needs a choice, and on Yes some text. Otherwise the error appears under the tiles ("Choose one.") or the textarea ("Describe it in a few words, or choose No."), and the focus moves there.
- **Back** keeps what was typed. All Answers are sent together at the end: `POST /runs/:id/answers` with `{ answers: Answer[] }`, the text trimmed. On `202`, go to the progress view.
- **A 400 `INVALID_ANSWERS`** shows the server message above the footer; it never echoes the text.
- **The draft** is kept in `sessionStorage` per Run, so a refresh keeps the place and the typing.
- **Announcements:** each new Question is announced ("Question 2 of 3: …") through the status region.
