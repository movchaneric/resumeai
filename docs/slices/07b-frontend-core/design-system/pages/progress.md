# Page: Live progress (`/runs/:id`, status `parsing`, `extracting`, `tailoring`)

Direction B. Mockup board: "B · Live progress".

## Purpose
Show that work is happening, where it is, and what it has achieved so far, and that the user can leave and come back.

## Layout
- **Header:** a **"Copy link to this Run"** button. It copies the URL and confirms with a toast, "Link copied".
- One centred column, 560px max:
  - **Title:** "Tailoring your CV" (a `role="status"` region; while parsing, it's "Reading your CV…").
  - **The lead:** "You can leave this page. Your Run keeps going, and the link above brings you back to it for 7 days."
  - **One raised card:**
    - **The Match Score so far** (from `tailoring`'s `score`): before → after with a "+16" delta chip, and "Round 2 of 3" (`iterations`). Until `score.after` arrives, "after" shows "—".
    - **The step list,** from `steps`, with the labels grouped into user language:

      | step key(s) | label |
      |---|---|
      | parse, extract | Read your CV and the job |
      | coverage | Checked the Requirements |
      | questions | Your answers (it's "Skipped: nothing to ask" when no Questions were asked, if the step reports it) |
      | tailor | Tailoring |
      | fit | Fit it on one page |
      | review | Your Review |

      - **Done steps** fade to `--fg-2` with a green check.
      - **The running step** is an `--accent-soft` row with a spinner, its round, and a one-line explanation:
        - tailor: "Rewording bullets toward the Requirements, checking each against its Evidence.";
        - fit: "Rewording shorter, then removing the least relevant bullets. You'll decide on each.".
      - **Pending steps** are `--fg-3` with an empty circle.

## Live behaviour
- **Updates:** SSE on `/runs/:id/events`, where each event replaces the cached view. When the stream ends, refetch and render the next screen at the same URL.
- **Fallback:** polling every 3s. After 3 failures, show "Lost connection. Retrying…" inline.
- **Announcements:** a step change ("Tailoring, round 2 of 3"). The score is announced only when a round ends.

## Final non-success states (same route)
- **`failed`:** the step list marks the step that broke. A card shows a message for each `error.code`, then "Start a new Run".

  | Code | Message |
  |---|---|
  | `EXTRACTION_FAILED` | "We couldn't understand this CV or Job Description." / "Try again; if it keeps failing, try the other file format." |
  | `NO_REQUIREMENTS` | "We found no Requirements in this Job Description." / "Paste the full posting, including its requirements." |
  | `COVERAGE_FAILED` | "We couldn't compare your CV with the job." / "Try again in a moment." |
  | `INTERNAL` | "Something broke on our side." / "Try again in a moment." |

- **`interrupted`:** "This Run was cut off by a server restart and can't continue." / "Start a new Run with the same files."
