# Design system: Resume AI (master)

The global source of truth for the frontend's look and behaviour. A page file in `pages/` overrides this one where they differ.

**How it was made (2026-10-27).** It was done in two passes with the UI UX Pro Max skill (v2.15.0); the owner chose **Direction B, "Modern"**.
- **Direction A ("Classic")** came first: navy, Lexend with Source Sans 3, a tracked-changes list. The owner found it fine but not what they expected, and asked for something more modern and clean with very good UX.
- **Direction B** came from a second `--design-system` run (variance 5, motion 4, density 5):
  - **Kept** from that run: Flat style, and Plus Jakarta Sans (the skill's pick for "SaaS, web apps, productivity tools").
  - **Not used:** its teal-and-orange palette on a tinted background, because it doesn't read as clean. A monochrome zinc palette with one indigo accent replaces it.
  - **Still dropped:** the skill's landing-page patterns and GSAP motion (see the history of this file for A's reasons).

**Mockups:** a private Claude Design canvas, "Resume AI screens", kept outside the repo (the owner has the link). Page **B · Modern** is the chosen direction; page A is kept for reference only. Where a mockup and this file disagree, this file wins.

## Principles
1. **Trust over flash.** The product's promise is "never invents facts". Every Change shows what it's based on (its Evidence) next to the decision buttons, never hidden.
2. **The CV is the canvas.** Review reads like a document in "suggesting mode": the clean CV page with light inline marks, and the Changes as cards in the margin.
3. **One thing at a time where it helps.** Questions come one per screen. On a phone, Review is a "focus mode" with one Change per card.
4. **Keyboard first on desktop.** Every decision has a key, and the keys are shown next to the controls (`kbd` chips).
5. **Domain words in the UI.** The copy uses `CONTEXT.md` terms: Run, Change, Review, Requirement, Match Score, Confirmed Gap, Tailored CV. It never says "resume", "suggestion", "ATS score" or "keyword".
6. **Never color alone.** Every state also has a word, an icon or a text decoration (strikethrough, underline).
7. **Show only what the API gives.** The copy and counts come from `RunView`. No invented timings, page counts, or per-bullet line savings.

## Mode
**Light only for v1.** The tokens are semantic, so dark mode can be added later as a second token set. The auth pages' brand panel is dark by design: it's a surface, not a theme.

## Color tokens
Components use only these tokens, never raw hex. Contrast was measured on 2026-10-27.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#FAFAFA` | app background |
| `--surface` | `#FFFFFF` | cards, the CV page, inputs |
| `--fg` | `#18181B` | body text (17.0:1 on bg), primary button fill (white text 17.7:1) |
| `--fg-2` | `#52525B` | secondary text (7.4:1 on bg) |
| `--fg-3` | `#71717A` | meta text, input and secondary-button outlines (4.6:1 on bg, 4.8:1 on surface) |
| `--line` | `#E4E4E7` | decorative dividers and card rings only (never a control's only boundary) |
| `--soft` | `#F4F4F5` | quiet fills: the Evidence box, progress-bar tracks |
| `--accent` | `#4F46E5` | links, focus ring, progress, the selected card ring (6.3:1 on surface) |
| `--accent-soft` / `--accent-fg` | `#EEF2FF` / `#3730A3` | the selected Change in the CV, type badges, the running step (8.9:1) |
| `--ok` / `--ok-soft` | `#047857` / `#ECFDF5` | accepted, met, done, added text, delta chips (5.5:1 on surface, 5.2:1 on soft) |
| `--del` | `#BE123C` | strikethrough color on removed text (6.3:1) |
| `--warn-soft` / `--warn-fg` / `--warn-line` | `#FFFBEB` / `#78350F` / `#FCD34D` | the "over one page" chip (8.8:1) |
| `--danger` | `#B91C1C` | errors, Delete Run (6.5:1) |
| **Dark brand panel (auth):** `#18181B` bg, `#27272A` raised, `#3F3F46` ring | | text `#FAFAFA` and `#D4D4D8`, muted `#A1A1AA` (5.8:1 on raised), added `#6EE7B7` (9.8:1), badge `#C7D2FE` on `#312E81` (7.7:1) |

## Typography
- **Plus Jakarta Sans** (400, 500, 600, 700) for everything, via Google Fonts with `display=swap`. Use `-webkit-font-smoothing: antialiased`.
- **Scale (px):** 11 and 12 (eyebrows, kbd, meta), 13, 14 (dense UI on Review), 15 (body), 17 (lead), 26 to 30 (page titles), 34 to 44 (hero and auth headlines), 64 (the final score).
- **Headings:** weight 700 with letter-spacing −0.02em, down to −0.04em on the big numbers. Body line-height 1.55.
- **Eyebrow labels:** 11px, weight 600 to 700, uppercase, letter-spacing 0.08 to 0.1em, `--fg-3`. Used for CV section headings and panel groups.
- **Numbers:** `tabular-nums`.

## Shape, spacing, elevation
- **Radius:** 8px small controls, 10px inputs, 12px buttons and cards, 14px option tiles, 16px hero cards and phone cards, and 999px chips and progress bars.
- **Spacing:** 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 64px. Review is tighter (8 to 14 inside cards); flows like Upload and Questions breathe (24 to 40).
- **Elevation:** rings instead of borders, `box-shadow: 0 0 0 1px var(--line)`.
  - **Raised cards** (the CV page, hero forms): `0 1px 3px rgb(0 0 0 / .05), 0 12–16px 32–40px -16–20px rgb(0 0 0 / .12–.16)`.
  - **The selected Change card:** `0 0 0 2px var(--accent)` plus a soft indigo glow.
- **Layout:** flow pages are a single centred column of 560 to 960px. Review is a 1400px max width with three areas. The gutter is 16px on phones and 24px from 768px. Check at 375, 768, 1024 and 1440px.

## Motion
- CSS only, 150 to 200ms `ease-out` on enter and a little faster on exit, animating opacity, transform and colors.
- A Change card expands and collapses with a 150ms height-free transition (opacity and transform on the content).
- The sticky Review bar has `backdrop-filter: blur(8px)` over 90% white.
- `prefers-reduced-motion` turns transitions off. The running-step spinner becomes a static icon with its text.

## Icons
**Lucide**, 2px stroke, 16 to 18px, never emoji. Decorative icons get `aria-hidden`; icon-only buttons get an `aria-label`. The meanings are as in Direction A, plus: `link` (copy the Run link), `eye` (show the password), `more-horizontal` (the Run menu), `info` (hints).

## Components
- **Buttons:**
  - **primary:** `--fg` fill, white text, 12px radius, 48px tall in flows and 40px in the Review bar;
  - **secondary:** surface with a `--fg-3` ring;
  - **ghost and link:** accent text;
  - **danger link:** `--danger` text.

  A busy state keeps the width and shows a spinner and a verb.
- **Chips:**
  - status chips in the Review bar (fit, score), pill-shaped and clickable to open details;
  - type badges ("Rewording", "Removal") in `--accent-soft`;
  - delta chips ("+16") in `--ok-soft`.
- **Option tile:** a whole-card radio (`<label>` wrapping an `<input type=radio>`), selected with a 2px accent ring and a `kbd` hint.
- **kbd:** an 11px chip with a 2px bottom border, shown next to the action it triggers.
- **Change card:** see `pages/review.md`.
- **Progress bar:** a 6px track in `--soft` with an `--accent` fill, and `role="progressbar"` with values.
- **Field:**
  - a visible label above;
  - helper or counter text below in `--fg-3`;
  - the error below in `--danger` with an icon, linked with `aria-describedby`, and the input ring turns `--danger` (`aria-invalid`).

## App shell
- **Header:** the "R" mark plus "Resume AI", and the job ("Senior Backend Engineer · Northwind Labs") once known. A "Sign in" link sits on every page.
  - **On Run pages:** a **"Copy link to this Run"** button, because a guest's Run is reachable only by its link.
  - **The ⋯ menu** holds "Copy link" and "Delete Run". Delete confirms in a dialog, calls `DELETE /runs/:id`, then goes to `/`.
- **Routes:**

  | Route | Screen |
  |---|---|
  | `/` | Upload. **The app's entry** (decided in the grilling: accounts don't work yet, so nothing stands in front of it) |
  | `/sign-in` | Sign in (UI only, see `pages/auth.md`); "Enter as a guest" leads to `/` |
  | `/sign-up` | Sign up (UI only) |
  | `/runs/:id` | One route that renders the screen for `status`, so a refresh or a shared link lands on the right step. |
  | unknown or expired Run (404) | "This Run doesn't exist or has expired", with "Start a new Run". |

- **Live updates:** `EventSource` on `GET /runs/:id/events` while the status is `parsing`, `extracting` or `tailoring`. The fallback is polling `GET /runs/:id` every 3s.

## Accessibility rules (must pass)
- **Contrast:** text at least 4.5:1, UI parts at least 3:1. The tokens above are measured; `--line` is never the only boundary of a control.
- **Keyboard:**
  - Full keyboard paths everywhere, with a visible 2px `--accent` focus ring at a 2px offset.
  - Single-key shortcuts (J, K, A, R, E, D, 1, 2) work only when the focus isn't in a text field, and a "Keyboard shortcuts" toggle can turn them off (WCAG 2.1.4).
- **Announcements:** one `role="status"` region per screen, announcing a sentence ("3 lines over one page", "Tailoring, round 2 of 3"), never a bare number.
- **Errors** sit next to their field. On submit, the focus moves to the first error.
- **Layout** holds at 200% zoom and 375px wide, with no horizontal scroll. Live values (fit, score, counters) keep a reserved size so nothing jumps.

## Pre-delivery checklist
- [ ] No emoji icons; Lucide SVG only
- [ ] `cursor: pointer` and 150 to 200ms hover states on everything clickable
- [ ] Focus visible on every control; shortcuts can be turned off
- [ ] `prefers-reduced-motion` respected
- [ ] Checked at 375, 768, 1024 and 1440px
- [ ] Copy uses `CONTEXT.md` terms and only data the API returns
