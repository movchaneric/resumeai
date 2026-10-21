/** Extraction gave up after its retry. `issues` are readable lines about what was wrong. Never reaches HTTP. */
export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

/** The Job Description produced no Requirements. Not retried. */
export class NoRequirementsError extends Error {
  constructor(message = "No requirements found in the job description") {
    super(message);
    this.name = "NoRequirementsError";
  }
}
