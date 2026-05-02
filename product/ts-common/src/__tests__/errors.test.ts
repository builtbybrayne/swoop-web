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
});
