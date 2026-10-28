import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RUN_ID } from "../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp, serveIdleStream } from "../../helpers/render";
import { server } from "../../helpers/server";

const pdf = (name = "cv.pdf", size = 10) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

/** jsdom's FormData can't pass through MSW, so the POST is answered by a stubbed fetch. */
function stubUpload(response: () => Response) {
  const spy = vi.fn(async () => response());
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function fill(user: ReturnType<typeof userEvent.setup>, file: File | null, text: string) {
  if (file) await user.upload(screen.getByLabelText(/Choose a file or drop it here/), file);
  if (text) await user.click(screen.getByLabelText("Job Description")), await user.paste(text);
}

afterEach(() => vi.unstubAllGlobals());

describe("Upload screen", () => {
  it("shows the hero, the form, the steps, one status region and no axe violations", async () => {
    const { container } = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Tailor your CV to the job you want" })).toBeInTheDocument();
    expect(screen.getByText("PDF or Word, up to 5 MB and 5 pages")).toBeInTheDocument();
    expect(screen.getByText("0 / 20,000")).toBeInTheDocument();
    expect(screen.getByText("Paste the whole posting, requirements included.")).toBeInTheDocument();
    expect(screen.getByText("No account needed · Deleted after 7 days, or sooner if you ask")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });

  it("has a labelled file input a keyboard can reach, and counts the Job Description", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const input = await screen.findByLabelText(/Choose a file or drop it here/);
    expect(input).toHaveAttribute("type", "file");
    await user.tab(); // logo
    await user.tab(); // Sign in
    await user.tab();
    expect(input).toHaveFocus();
    await user.click(screen.getByLabelText("Job Description"));
    await user.paste("Backend engineer");
    expect(screen.getByText("16 / 20,000")).toBeInTheDocument();
  });

  it("shows the chosen file with a way to change it", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");
    await fill(user, pdf("my-cv.pdf", 2048), "");
    expect(screen.getByText("my-cv.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF · 2 KB")).toBeInTheDocument();
    expect(screen.getByText("Choose a different file")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("rejects an unsupported type on the client, under the CV pane", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/");
    await fill(user, new File(["x"], "cv.txt", { type: "text/plain" }), "Role");
    expect(screen.getByText("This file type isn't supported.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tailor my CV →" }));
    expect(screen.getByLabelText(/Choose a file or drop it here|Choose a different file/)).toHaveFocus();
  });

  it("rejects a file over 5 MB on the client", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await fill(user, pdf("big.pdf", 5 * 1024 * 1024 + 1), "");
    expect(screen.getByText("This file is over 5 MB.")).toBeInTheDocument();
  });

  it("asks for the missing pieces and moves the focus to the first error", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Tailor my CV →" }));
    expect(screen.getByText("Choose your CV.")).toBeInTheDocument();
    expect(screen.getByText("Paste the Job Description.")).toBeInTheDocument();
    const input = container.querySelector("input[type=file]")!;
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    const area = screen.getByLabelText("Job Description");
    expect(area).toHaveAttribute("aria-invalid", "true");
    expect(area.getAttribute("aria-describedby")).toContain("error");
    await expectNoSeriousViolations(container);
  });

  it("rejects a Job Description over 20,000 characters under its pane", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await fill(user, pdf(), "");
    fireEvent.change(screen.getByLabelText("Job Description"), { target: { value: "a".repeat(20_001) } });
    await user.click(screen.getByRole("button", { name: "Tailor my CV →" }));
    expect(screen.getByText("The Job Description is over 20,000 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Job Description")).toHaveFocus();
  });

  it("uploads, shows Uploading…, and goes to the Run on 201", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    const spy = vi.fn(() => new Promise<Response>((r) => (release = r)));
    vi.stubGlobal("fetch", spy);
    serveIdleStream(RUN_ID);
    server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json({ code: "RUN_NOT_FOUND", message: "x" }, { status: 404 })));
    const { router } = renderApp("/");
    await fill(user, pdf(), "Backend role");
    await user.click(screen.getByRole("button", { name: "Tailor my CV →" }));
    expect(await screen.findByRole("button", { name: "Uploading…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Uploading");
    release(Response.json({ id: RUN_ID }, { status: 201 }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/runs/${RUN_ID}`));
    const form = (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get("jobDescription")).toBe("Backend role");
  });

  it.each([
    ["SCANNED_PDF", "This PDF looks scanned: there's no text to read.", "Export it from your editor as PDF or Word instead of scanning."],
    ["TOO_MANY_PAGES", "This CV is longer than 5 pages.", "Upload a shorter version."],
    ["UNREADABLE_FILE", "We couldn't read this file.", "Check that it opens, then try again, or try the other format."],
    ["JOB_DESCRIPTION_TOO_LONG", "The Job Description is over 20,000 characters.", "Remove the company boilerplate and keep the role and its requirements."],
  ])("shows %s under its pane with the next step", async (code, title, hint) => {
    const user = userEvent.setup();
    stubUpload(() => Response.json({ code, message: "server words" }, { status: 400 }));
    const { container } = renderApp("/");
    await fill(user, pdf(), "Role");
    await user.click(screen.getByRole("button", { name: "Tailor my CV →" }));
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(hint, { exact: false })).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("shows an unknown error above the footer with the server's message as the next step", async () => {
    const user = userEvent.setup();
    stubUpload(() => Response.json({ code: "RUN_BUSY", message: "Try the other door." }, { status: 409 }));
    renderApp("/");
    await fill(user, pdf(), "Role");
    await user.click(screen.getByRole("button", { name: "Tailor my CV →" }));
    expect(await screen.findByText("Something went wrong on our side.")).toBeInTheDocument();
    expect(screen.getByText(/Try the other door\./)).toBeInTheDocument();
  });

  it("shows a network error as 'Try again in a moment.'", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    renderApp("/");
    await fill(user, pdf(), "Role");
    await user.click(screen.getByRole("button", { name: "Tailor my CV →" }));
    expect(await screen.findByText("Something went wrong on our side.")).toBeInTheDocument();
    expect(screen.getByText(/Try again in a moment\./)).toBeInTheDocument();
  });

  it("shows the Drop your CV overlay while a file is dragged over the page, and takes the dropped file", async () => {
    renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    const file = pdf("dropped.pdf");
    const dataTransfer = { types: ["Files"], files: [file] };
    fireEvent.dragEnter(document.body, { dataTransfer });
    expect(await screen.findByText("Drop your CV")).toBeInTheDocument();
    fireEvent.drop(document.body, { dataTransfer });
    await waitFor(() => expect(screen.queryByText("Drop your CV")).toBeNull());
    expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
  });

  it("ignores drags that carry no files, and stops listening after unmount", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(screen.queryByText("Drop your CV")).toBeNull();
    unmount();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["dragenter", "dragover", "dragleave", "drop"]));
    remove.mockRestore();
  });
});
