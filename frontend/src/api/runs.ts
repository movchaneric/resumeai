import { z } from "zod";
import { RunIdSchema, ReviewFitSchema, RunViewSchema, type Answer, type ReviewSubmission, type RunView } from "@resume-ai/shared";
import { apiUrl } from "@/api/config";
import { jsonBody, requestBlob, requestJson, requestVoid } from "@/api/http";

const RunRefSchema = z.object({ id: RunIdSchema });

export interface CreateRunInput {
  cv: File;
  jobDescription: string;
}

/** `POST /runs` (multipart): the CV in `cv`, the Job Description in `jobDescription`. Returns the new Run's ID. */
export async function createRun({ cv, jobDescription }: CreateRunInput) {
  const form = new FormData();
  form.append("cv", cv);
  form.append("jobDescription", jobDescription);
  return (await requestJson("/runs", RunRefSchema, { method: "POST", body: form })).id;
}

export function getRun(id: string): Promise<RunView> {
  return requestJson(`/runs/${encodeURIComponent(id)}`, RunViewSchema);
}

/** `202`: the Answers are accepted and the Run resumes; keep reading the Run. */
export async function answer(id: string, answers: Answer[]) {
  return (await requestJson(`/runs/${encodeURIComponent(id)}/answers`, RunRefSchema, jsonBody({ answers }))).id;
}

/** `202`: the decisions are accepted and the Run resumes. */
export async function submitReview(id: string, submission: ReviewSubmission) {
  return (await requestJson(`/runs/${encodeURIComponent(id)}/review`, RunRefSchema, jsonBody(submission))).id;
}

/** The fit of a Review as it would be submitted. Nothing is submitted. */
export function previewReview(id: string, submission: ReviewSubmission, signal?: AbortSignal) {
  return requestJson(`/runs/${encodeURIComponent(id)}/review/preview`, ReviewFitSchema, { ...jsonBody(submission), signal });
}

export function deleteRun(id: string): Promise<void> {
  return requestVoid(`/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** A link for the browser to follow: the Tailored CV as a file. */
export function downloadUrl(id: string, format: "pdf" | "docx"): string {
  return apiUrl(`/runs/${encodeURIComponent(id)}/cv.${format}`);
}

/** The Tailored CV as a file, fetched so a failure (409 `CV_TOO_LONG`) arrives as an `ApiError` a link could not show. */
export function downloadCv(id: string, format: "pdf" | "docx"): Promise<{ blob: Blob; filename: string | null }> {
  return requestBlob(`/runs/${encodeURIComponent(id)}/cv.${format}`);
}
