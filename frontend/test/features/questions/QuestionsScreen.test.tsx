import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHORTCUTS_KEY } from "@/features/shortcuts/useShortcuts";
import { RUN_ID, runView } from "../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp, serveIdleStream, serveRun } from "../../helpers/render";
import { server } from "../../helpers/server";

const PATH = `/runs/${RUN_ID}`;
const DRAFT_KEY = `resume-ai:draft:${RUN_ID}`;
const QUESTIONS = [
  { id: "q1", requirementId: "r1", text: "Have you used Node.js?" },
  { id: "q2", requirementId: "r2", text: "Have you run Kubernetes in production?" },
  { id: "q3", requirementId: "r3", text: "Have you led a team?" },
];

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

async function open(questions = QUESTIONS) {
  serveRun(RUN_ID, runView("awaiting_answers", { questions }));
  serveIdleStream(RUN_ID);
  const utils = renderApp(PATH);
  await screen.findByRole("heading", { level: 1, name: questions[0]!.text });
  return utils;
}

const yes = () => screen.getByRole("radio", { name: /Yes, I've done this/ });
const no = () => screen.getByRole("radio", { name: /No, I haven't/ });

function captureAnswers() {
  const bodies: unknown[] = [];
  server.use(
    http.post(`/api/runs/${RUN_ID}/answers`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ id: RUN_ID }, { status: 202 });
    }),
  );
  return bodies;
}

describe("Questions screen", () => {
  it("shows the first Question with the spec copy, nothing preselected, and passes axe", async () => {
    const { container } = await open();
    expect(screen.getByText("Question 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("A must-have your CV doesn't clearly show")).toBeInTheDocument();
    expect(screen.getByText("A sentence or two is enough. Saying no is fine: we won't claim it.")).toBeInTheDocument();
    expect(yes()).not.toBeChecked();
    expect(no()).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "‹ Back" })).toBeNull();
    expect(screen.getByRole("button", { name: /Next question/ })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Question 1 of 3: Have you used Node.js?");
    await expectNoSeriousViolations(container);
  });

  it("asks for a choice, then for text on Yes, with the error next to the field and the focus on it", async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await user.click(screen.getByRole("button", { name: /Next question/ }));
    expect(screen.getByText("Choose one.")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(screen.getAllByRole("radio")[0]);
    await expectNoSeriousViolations(container);

    await user.click(yes());
    const box = screen.getByLabelText("What did you build, and with what?");
    expect(box).toHaveFocus();
    expect(screen.getByText("0 / 1,000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Next question/ }));
    expect(screen.getByText("Describe it in a few words, or choose No.")).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAttribute("aria-describedby");
    expect(box).toHaveFocus();
    await expectNoSeriousViolations(container);

    await user.type(box, "   ");
    await user.click(screen.getByRole("button", { name: /Next question/ }));
    expect(screen.getByText("Describe it in a few words, or choose No.")).toBeInTheDocument();
  });

  it("keeps the answers going forward and back, and sends them together with the text trimmed", async () => {
    const user = userEvent.setup();
    const bodies = captureAnswers();
    await open();

    await user.click(yes());
    await user.type(screen.getByLabelText("What did you build, and with what?"), "  Built APIs in Node.  ");
    await user.click(screen.getByRole("button", { name: /Next question/ }));
    expect(await screen.findByRole("heading", { level: 1, name: QUESTIONS[1]!.text })).toBeInTheDocument();
    expect(screen.getByText("Question 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Question 2 of 3: Have you run Kubernetes in production?");

    await user.click(no());
    await user.click(screen.getByRole("button", { name: /Next question/ }));
    expect(await screen.findByRole("button", { name: /Start tailoring/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "‹ Back" }));
    expect(no()).toBeChecked();
    await user.click(screen.getByRole("button", { name: "‹ Back" }));
    expect(yes()).toBeChecked();
    expect(screen.getByLabelText("What did you build, and with what?")).toHaveValue("  Built APIs in Node.  ");

    await user.click(screen.getByRole("button", { name: /Next question/ }));
    await user.click(screen.getByRole("button", { name: /Next question/ }));
    await user.click(yes());
    await user.type(screen.getByLabelText("What did you build, and with what?"), "Led four people.");
    serveRun(RUN_ID, runView("tailoring"));
    await user.click(screen.getByRole("button", { name: /Start tailoring/ }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      answers: [
        { kind: "has_experience", questionId: "q1", text: "Built APIs in Node." },
        { kind: "no_experience", questionId: "q2" },
        { kind: "has_experience", questionId: "q3", text: "Led four people." },
      ],
    });
    expect(await screen.findByRole("heading", { name: "Tailoring your CV" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("restores the place and the typing after a refresh", async () => {
    const user = userEvent.setup();
    const first = await open();
    await user.click(yes());
    await user.type(screen.getByLabelText("What did you build, and with what?"), "Node services");
    await user.click(screen.getByRole("button", { name: /Next question/ }));
    await user.click(yes());
    await user.type(screen.getByLabelText("What did you build, and with what?"), "half typed");
    first.unmount();

    renderApp(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: QUESTIONS[1]!.text })).toBeInTheDocument();
    expect(screen.getByLabelText("What did you build, and with what?")).toHaveValue("half typed");
    await user.click(screen.getByRole("button", { name: "‹ Back" }));
    expect(screen.getByLabelText("What did you build, and with what?")).toHaveValue("Node services");
  });

  it("ignores a broken draft", async () => {
    window.sessionStorage.setItem(DRAFT_KEY, "{nope");
    await open();
    expect(screen.getByText("Question 1 of 3")).toBeInTheDocument();
  });

  it("shows the server message above the footer on a 400 INVALID_ANSWERS and lets the user retry", async () => {
    const user = userEvent.setup();
    server.use(http.post(`/api/runs/${RUN_ID}/answers`, () => HttpResponse.json({ code: "INVALID_ANSWERS", message: "Answers do not match the Questions." }, { status: 400 })));
    await open([QUESTIONS[0]!]);
    await user.click(no());
    await user.click(screen.getByRole("button", { name: /Start tailoring/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Answers do not match the Questions.");
    expect(screen.getByRole("button", { name: /Start tailoring/ })).toBeEnabled();
  });

  describe("shortcuts", () => {
    it("1 and 2 choose, but never inside the textarea; Ctrl+Enter goes on from anywhere", async () => {
      const user = userEvent.setup();
      await open();
      await user.keyboard("1");
      expect(yes()).toBeChecked();
      const box = screen.getByLabelText("What did you build, and with what?");
      expect(box).toHaveFocus();
      await user.keyboard("12 ok");
      expect(box).toHaveValue("12 ok");
      expect(yes()).toBeChecked();

      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(await screen.findByRole("heading", { level: 1, name: QUESTIONS[1]!.text })).toBeInTheDocument();
      (document.activeElement as HTMLElement | null)?.blur();
      await user.keyboard("2");
      expect(no()).toBeChecked();
    });

    it("do nothing when the user switched them off, and the hints go away", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(SHORTCUTS_KEY, "off");
      await open();
      expect(screen.queryByText("⌘ Enter")).toBeNull();
      await user.keyboard("1");
      expect(yes()).not.toBeChecked();
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(screen.queryByText("Choose one.")).toBeNull();

      await user.click(screen.getByRole("checkbox", { name: "Keyboard shortcuts" }));
      await user.keyboard("2");
      expect(no()).toBeChecked();
      expect(screen.getByText("⌘ Enter")).toBeInTheDocument();
    });
  });
});
