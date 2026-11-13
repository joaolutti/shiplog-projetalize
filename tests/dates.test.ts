// Business hours for reminders: São Paulo, Monday–Friday, 9:00–18:00 (UTC-3).
import { describe, expect, it } from "vitest";
import { nextBusinessTime } from "@/lib/dates";

const sp = (local: string) => new Date(`${local}-03:00`);

describe("nextBusinessTime", () => {
  it("keeps a time inside business hours", () => {
    expect(nextBusinessTime(sp("2026-11-11T09:00:00"))).toEqual(sp("2026-11-11T09:00:00"));
    expect(nextBusinessTime(sp("2026-11-11T17:59:00"))).toEqual(sp("2026-11-11T17:59:00"));
  });

  it("moves early morning to 9:00 the same day, and evening to 9:00 the next day", () => {
    expect(nextBusinessTime(sp("2026-11-11T06:30:00"))).toEqual(sp("2026-11-11T09:00:00"));
    expect(nextBusinessTime(sp("2026-11-11T18:00:00"))).toEqual(sp("2026-11-12T09:00:00"));
    expect(nextBusinessTime(sp("2026-11-11T23:30:00"))).toEqual(sp("2026-11-12T09:00:00"));
  });

  it("skips the weekend", () => {
    // 2026-11-13 is a Friday.
    expect(nextBusinessTime(sp("2026-11-13T20:00:00"))).toEqual(sp("2026-11-16T09:00:00"));
    expect(nextBusinessTime(sp("2026-11-14T08:00:00"))).toEqual(sp("2026-11-16T09:00:00"));
    expect(nextBusinessTime(sp("2026-11-15T12:00:00"))).toEqual(sp("2026-11-16T09:00:00"));
  });
});
