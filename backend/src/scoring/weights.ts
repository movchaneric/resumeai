/*
 * Inputs to the deterministic Match Score. These are initial, tunable values chosen for v1;
 * they are scoring logic, so they live here and not in the shared schemas.
 */
export const IMPORTANCE_WEIGHT = { must_have: 3, nice_to_have: 1 } as const;

/** Credit a Requirement earns for each Coverage verdict. */
export const VERDICT_CREDIT = { met: 1, partially_met: 0.5, unmet: 0 } as const;
