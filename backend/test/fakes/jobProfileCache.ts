import type { JobProfile } from "@resume-ai/shared";
import type { JobProfileCache } from "@/graph/jobProfileCache.js";

/** In-memory stand-in for the Job Profile store: first write wins, and it can be made to throw. */
export class FakeJobProfileCache implements JobProfileCache {
  readonly rows = new Map<string, JobProfile>();
  readonly gets: string[] = [];
  failGet = false;
  failPut = false;

  async get(key: string): Promise<JobProfile | null> {
    this.gets.push(key);
    if (this.failGet) throw new Error("cache down");
    return this.rows.get(key) ?? null;
  }

  async put(key: string, profile: JobProfile): Promise<void> {
    if (this.failPut) throw new Error("cache down");
    if (!this.rows.has(key)) this.rows.set(key, profile);
  }
}
