import { test } from "node:test";
import assert from "node:assert/strict";
import { RegisterInput } from "./validation.js";
import { config } from "./config.js";

const profile = (dateOfBirth: string) => ({
  firstName: "Test",
  lastName: "Teacher",
  email: "dob@example.com",
  username: "dob.teacher",
  dateOfBirth,
  timezone: "Africa/Johannesburg",
  acceptTerms: true,
});
test("DOB accepts matching day numbers and the exact minimum-age birthday", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-09-12T12:00:00Z"),
  });
  assert.equal(RegisterInput.safeParse(profile("2000-02-12")).success, true);
  assert.equal(RegisterInput.safeParse(profile("2000-09-12")).success, true);
  const year = 2026 - config.MIN_ACCOUNT_AGE_YEARS;
  assert.equal(RegisterInput.safeParse(profile(`${year}-09-12`)).success, true);
  assert.equal(
    RegisterInput.safeParse(profile(`${year}-09-13`)).success,
    false,
  );
  assert.equal(RegisterInput.safeParse(profile("2000-02-31")).success, false);
  assert.equal(RegisterInput.safeParse(profile("2000-02-29")).success, true);
});
