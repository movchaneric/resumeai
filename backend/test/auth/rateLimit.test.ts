import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { APP_ORIGIN, makeAuthApp } from "../fakes/authApp.js";

const { app, prisma } = makeAuthApp({ AUTH_RATE_LIMIT: "on" });

afterAll(async () => {
  await prisma.$disconnect();
});

describe("auth rate limiting", () => {
  it("answers 429 after too many sign-in attempts from one address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await request(app)
        .post("/api/auth/sign-in/email")
        .set("Origin", APP_ORIGIN)
        .set("X-Forwarded-For", "203.0.113.7")
        .send({ email: "nobody@example.com", password: "whatever-1234" });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
