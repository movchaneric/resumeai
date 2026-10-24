import type { CoverageVerdict, Importance } from "@resume-ai/shared";

/*
 * Inputs to the deterministic Match Score (ADR 0004 values for v1: must-have 3, nice-to-have 1;
 * met 1, partially met 0.5, unmet 0). They are scoring logic, so they live here and not in the shared schemas.
 */
export const IMPORTANCE_WEIGHTS: Record<Importance, number> = { must_have: 3, nice_to_have: 1 };

/** Credit a Requirement earns for each Coverage verdict. */
export const VERDICT_CREDITS: Record<CoverageVerdict, number> = { met: 1, partially_met: 0.5, unmet: 0 };
