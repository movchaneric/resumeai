/** The claim check gave up after its retry. `issues` are readable lines about what was wrong. Never reaches HTTP. */
export class ClaimCheckError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "ClaimCheckError";
  }
}
