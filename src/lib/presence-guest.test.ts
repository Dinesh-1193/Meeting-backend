import { describe, expect, it } from "vitest";
import { createGuestToken, verifyGuestToken } from "./guest-token";
import { derivePresenceStatus } from "./mappers";
import type { Profile } from "../types/database";

describe("guest tokens", () => {
  it("round-trips guest JWT claims", () => {
    const { token, guestId } = createGuestToken({
      name: "Ada",
      roomId: "room-1",
    });
    const claims = verifyGuestToken(token);
    expect(claims).toEqual({
      sub: guestId,
      name: "Ada",
      roomId: "room-1",
      typ: "guest",
    });
  });

  it("rejects tampered tokens", () => {
    const { token } = createGuestToken({ name: "Ada", roomId: "room-1" });
    expect(verifyGuestToken(token + "x")).toBeNull();
  });
});

describe("derivePresenceStatus", () => {
  const base: Profile = {
    id: "u1",
    email: "a@b.com",
    name: "Ada",
    avatar_url: null,
    title: "Engineer",
    last_seen_at: null,
    created_at: new Date().toISOString(),
  };

  it("marks in-meeting over last_seen", () => {
    expect(derivePresenceStatus(base, new Set(["u1"]))).toBe("in-meeting");
  });

  it("marks online when seen recently", () => {
    const profile = {
      ...base,
      last_seen_at: new Date().toISOString(),
    };
    expect(derivePresenceStatus(profile, new Set())).toBe("online");
  });

  it("marks offline when never seen", () => {
    expect(derivePresenceStatus(base, new Set())).toBe("offline");
  });
});
