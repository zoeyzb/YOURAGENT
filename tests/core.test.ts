import { describe, expect, it, vi } from "vitest";
import { evaluateCallPolicy } from "@/lib/policy";
import { MemoryIdempotencyStore, once } from "@/lib/idempotency";
import { resolveSkills } from "@/lib/skills";


describe("call policy", () => {
  it("blocks outbound calls without consent", () => {
    expect(evaluateCallPolicy({ direction: "outbound", consent: false, doNotCall: false, localHour: 14, jurisdiction: "US-IL" }))
      .toEqual({ allowed: false, reasons: ["missing_consent"] });
  });

  it("blocks suppressed numbers and late calls", () => {
    const decision = evaluateCallPolicy({ direction: "outbound", consent: true, doNotCall: true, localHour: 22, jurisdiction: "US-IL" });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("do_not_call");
    expect(decision.reasons).toContain("outside_calling_window");
  });

  it("allows inbound calls with a known jurisdiction", () => {
    expect(evaluateCallPolicy({ direction: "inbound", consent: false, doNotCall: true, localHour: 2, jurisdiction: "US-IL" }).allowed).toBe(true);
  });
});

describe("idempotency", () => {
  it("executes a side effect once", async () => {
    const store = new MemoryIdempotencyStore();
    const effect = vi.fn(async () => "sent");
    expect((await once(store, "event-12345678", effect)).executed).toBe(true);
    expect((await once(store, "event-12345678", effect)).executed).toBe(false);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});

describe("skill registry", () => {
  it("resolves known skills", () => {
    expect(resolveSkills(["conversation.active-listening", "sales.discovery"])).toHaveLength(2);
  });

  it("rejects unknown skills", () => {
    expect(() => resolveSkills(["does.not.exist"])).toThrow(/Unknown skills/);
  });
});
