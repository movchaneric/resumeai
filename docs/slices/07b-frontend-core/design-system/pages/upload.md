# Page: Upload (`/`)

Direction B. Mockup board: "B · Upload". The app's entry page; "Enter as a guest" on the auth pages also leads here.

## Purpose
Start a Run: one CV file and the Job Description text. It also says what the product does and doesn't do.

## Layout
- One centred column, 960px max.
- **Hero:**
  - "Tailor your CV to the job you want" (44px, 700, at most 16ch);
  - the lead: "It rewords and reorders what's already in your CV, asks about the gaps, and lets you approve every change. It never invents facts."
- **One raised form card** (16px radius) with two panes side by side that stack below 720px:
  - **Your CV:**
    - **Empty:** a drop target with "Choose a file or drop it here" and "PDF or Word, up to 5 MB and 5 pages". It's a real `<input type=file>` with a label, and works by keyboard.
    - **Chosen:** a file row with an icon, the name, the type and size, and a green check, plus "Choose a different file".
    - **Drop anywhere:** dropping a file anywhere on the page works, with a full-page overlay "Drop your CV" while dragging.
  - **Job Description** (on a `--bg` tint):
    - the label with a counter "1,240 / 20,000" on the same row;
    - a textarea of about 7 rows;
    - the helper "Paste the whole posting, requirements included."
  - **Footer row:**
    - "No account needed · Deleted after 7 days, or sooner if you ask";
    - the primary **"Tailor my CV →"**.
- **"How it works":**
  1. We read both.
  2. You fill the gaps (up to 5 questions).
  3. You approve every change, then download a one-page PDF or Word file.

## States and errors
- **Validation and submit:** client checks for the type, ≤ 5 MB and ≤ 20,000 characters. Submit shows "Uploading…" and on `201` goes to `/runs/:id`.
- **Rejections** (`RunErrorCode`) show inline under the pane they concern, as an icon and a title with the next step:

  | Code | Message |
  |---|---|
  | `UNSUPPORTED_FILE` | "This file type isn't supported." / "Upload a PDF or a Word (.docx) file." |
  | `FILE_TOO_LARGE` | "This file is over 5 MB." / "Save a smaller copy, or export it again without images." |
  | `TOO_MANY_PAGES` | "This CV is longer than 5 pages." / "Upload a shorter version." |
  | `SCANNED_PDF` | "This PDF looks scanned: there's no text to read." / "Export it from your editor as PDF or Word instead of scanning." |
  | `UNREADABLE_FILE` | "We couldn't read this file." / "Check that it opens, then try again, or try the other format." |
  | `JOB_DESCRIPTION_TOO_LONG` | "The Job Description is over 20,000 characters." / "Remove the company boilerplate and keep the role and its requirements." |
  | other / network | "Something went wrong on our side." / "Try again in a moment." |

  The server's `message` is the fallback.
