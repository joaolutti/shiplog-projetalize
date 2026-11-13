// node-postgres needs libpq's sslmode meaning; URLs without sslmode pass through.
import { describe, expect, it } from "vitest";
import { pgUrl } from "@/lib/db/pg-url";

describe("pgUrl", () => {
  it("adds uselibpqcompat when the URL sets sslmode, keeping the credentials", () => {
    const url = pgUrl("postgresql://postgres.abc:p%40ss@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require");
    expect(new URL(url).searchParams.get("uselibpqcompat")).toBe("true");
    expect(new URL(url).searchParams.get("sslmode")).toBe("require");
    expect(new URL(url).password).toBe("p%40ss");
  });

  it("leaves other URLs alone", () => {
    expect(pgUrl("postgres://shiplog:shiplog@localhost:5432/shiplog")).toBe("postgres://shiplog:shiplog@localhost:5432/shiplog");
    expect(pgUrl("postgres://a@h/db?sslmode=require&uselibpqcompat=true")).toBe("postgres://a@h/db?sslmode=require&uselibpqcompat=true");
  });
});
