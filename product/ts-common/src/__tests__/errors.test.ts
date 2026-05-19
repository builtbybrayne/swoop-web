/**
 * Tests for messageOf — H1 helper consolidation.
 *
 * Mirrors the cases enumerated in planning/03-exec-crosscut-common-helpers-fix.md
 * §"Verification": Error instance, plain object with message, primitive,
 * circular object (JSON.stringify throws), null/undefined.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { messageOf } from "../errors.js";

describe("messageOf", () => {
  it("returns Error.message for Error instances", () => {
    expect(messageOf(new Error("kaboom"))).toBe("kaboom");
  });

  it("returns the string for string primitives", () => {
    expect(messageOf("plain string")).toBe("plain string");
  });

  it("returns the message property for plain objects with message: string", () => {
    expect(messageOf({ message: "object message" })).toBe("object message");
  });

  it("ignores non-string message properties and falls through to JSON", () => {
    // {message: 123} → JSON.stringify path → '{"message":123}'.
    expect(messageOf({ message: 123 })).toBe('{"message":123}');
  });

  it("handles primitives that aren't strings via JSON.stringify", () => {
    expect(messageOf(42)).toBe("42");
    expect(messageOf(true)).toBe("true");
  });

  it("returns JSON for plain objects without message", () => {
    expect(messageOf({ foo: "bar" })).toBe('{"foo":"bar"}');
  });

  it("returns String(err) when JSON.stringify throws (circular ref)", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    // Circular triggers TypeError inside JSON.stringify; catch returns String(err).
    expect(messageOf(circular)).toBe(String(circular));
  });

  it("handles null and undefined without throwing", () => {
    expect(messageOf(null)).toBe("null");
    // JSON.stringify(undefined) → undefined; the `?? String(err)` keeps us
    // on the string side.
    expect(messageOf(undefined)).toBe(String(undefined));
  });

  it("handles Zod errors via the Error-instance branch", () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 42 });
    if (result.success) throw new Error("test fixture broke: parse should fail");
    // ZodError is an Error subclass; .message is its formatted issues string.
    const message = messageOf(result.error);
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 2026-05-19 demo-day diagnostic hardening — empty-Error.message fallback.
  // Node's AggregateError (thrown by pg on ECONNREFUSED) has `.message === ""`
  // and the real signal in `.errors[]`. The original messageOf returned ""
  // which propagated through the connector's `handler_threw` envelope as a
  // silent failure. These tests pin the new behaviour.
  // -------------------------------------------------------------------------

  it("falls back to the Error name when message is empty", () => {
    const err = new Error("");
    expect(messageOf(err)).toBe("Error");
  });

  it("includes the .code suffix for system errors with empty message", () => {
    const err = new Error("");
    (err as { code?: string }).code = "ENOENT";
    expect(messageOf(err)).toBe("Error [ENOENT]");
  });

  it("surfaces the first inner error from AggregateError-like shapes", () => {
    // Synthesise an AggregateError-shaped instance. In Node 16+ the real
    // AggregateError carries `errors`, an empty `message`, and `name:
    // 'AggregateError'`. We replicate that here so the test doesn't depend
    // on Node's `AggregateError` constructor signature.
    const inner = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const agg = new Error("");
    agg.name = "AggregateError";
    (agg as { code?: string }).code = "ECONNREFUSED";
    (agg as { errors?: unknown[] }).errors = [inner];

    expect(messageOf(agg)).toBe(
      "AggregateError [ECONNREFUSED]: connect ECONNREFUSED 127.0.0.1:5432",
    );
  });

  it("uses a string inner from AggregateError.errors[]", () => {
    const agg = new Error("");
    agg.name = "AggregateError";
    (agg as { errors?: unknown[] }).errors = ["raw string inner"];
    expect(messageOf(agg)).toBe("AggregateError: raw string inner");
  });

  it("skips empty inners and uses the first non-empty one", () => {
    const empty = new Error("");
    const real = new Error("the real problem");
    const agg = new Error("");
    agg.name = "AggregateError";
    (agg as { errors?: unknown[] }).errors = [empty, real];
    expect(messageOf(agg)).toBe("AggregateError: the real problem");
  });

  it("returns just the name when no inner errors are useful", () => {
    const agg = new Error("");
    agg.name = "AggregateError";
    (agg as { errors?: unknown[] }).errors = [new Error(""), null, undefined];
    expect(messageOf(agg)).toBe("AggregateError");
  });

  it("non-empty Error.message still wins (no regression on the dominant path)", () => {
    const err = new Error("real message");
    err.name = "AggregateError";
    (err as { code?: string }).code = "ECONNREFUSED";
    (err as { errors?: unknown[] }).errors = [new Error("inner")];
    // The non-empty top-level message is preferred over any inner-error
    // synthesis — the fallback only fires when there's nothing else to say.
    expect(messageOf(err)).toBe("real message");
  });
});
