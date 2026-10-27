# Pages: Sign in (`/sign-in`) and Sign up (`/sign-up`)

**UI only in this slice.** There is no auth backend yet, and a Run stays anonymous (`CONTEXT.md`, **Run**). The owner wants the pages now ("we are not going to implement the backend right now, I just want to have it"), plus an **"Enter as a guest"** button.

## Behaviour without a backend
- **The forms validate on the client:** a valid email, a password of at least 10 characters on sign-up, and a name required.
- **Submitting a valid form** shows an inline note under the button, without pretending to succeed: "Accounts are coming soon. Enter as a guest for now: everything works without one." There's no network call, and nothing is stored.
- **The app opens on Upload (`/`),** not on these pages. The header's "Sign in" link leads here.
- **"Enter as a guest"** goes to `/`. Nothing is remembered, since nobody is ever redirected to sign in.
- **"Forgot password?"** is visible but shows the same "coming soon" note.
- **Tickets:** the auth API, sessions, a "My Runs" list and linking Runs to an account are out of scope. They need their own spec and an ADR, since they change the anonymous Run.

## Layout (both pages)
- **Two halves.** They stack below 960px, with the brand panel first and shortened to its headline.
  - **Left:** the dark brand panel (`#18181B`), with the "R" mark and "Resume AI" at the top and a headline in the middle.
  - **Right:** the form column, 400px max, centred.
- **Sign in panel:**
  - Headline: "Your CV, tailored to the job. Nothing invented."
  - A sample Change card: a struck-through original, the reworded text, and "Based on your CV · …". It shows what the product does.
  - Three checkmarks: "Every change shows what it's based on", "You approve each one before download", "Always one page, PDF or Word".
- **Sign up panel:**
  - Headline: "Keep every tailored CV in one place."
  - Three benefits for the future account features: "All your Runs, listed", "Download again any time", "Delete it all in one click".

## Form column
- **Sign in:**
  - Title: "Welcome back", with the subtitle "Sign in to see your Runs."
  - **Fields:**
    - Email (`autocomplete=email`).
    - Password (`current-password`), with a show/hide eye button (`aria-label` "Show password" / "Hide password") and "Forgot password?" on the label row.
  - **Primary button:** "Sign in".
  - **Then:**
    - an "or" divider;
    - the secondary, full-width **"Enter as a guest →"**, with the note below it: "No account needed. Your Run stays at its link for 7 days.";
    - the footer "New here? **Create an account**".
- **Sign up:**
  - Title: "Create your account", with the subtitle "Free. Takes a minute."
  - **Fields:**
    - Name (`autocomplete=name`).
    - Email.
    - Password (`new-password`), with a live rule line, "At least 10 characters", that turns into a green check when met.
  - **Primary button:** "Create account".
  - **Then:** the same divider and **"Enter as a guest →"** block, and the footer "Already have an account? **Sign in**".
- **Errors** show on blur and on submit, below the field ("Enter a full email address, like name@example.com."), with `aria-invalid` and a red ring. The focus moves to the first error on submit.
