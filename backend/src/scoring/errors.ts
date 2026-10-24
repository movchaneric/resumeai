/** Coverage gave up after its retry. `issues` are readable lines about what was wrong. Never reaches HTTP. */
export class CoverageError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "CoverageError";
  }
}
