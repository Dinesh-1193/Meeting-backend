import { customAlphabet } from "nanoid";

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const gen = customAlphabet(alphabet, 10);

/** Compact room primary key, e.g. "k7m2xq9p1a" */
export function newRoomId(): string {
  return gen();
}

/** Stable personal meeting id from user UUID (shared with frontend). */
export function personalRoomId(userId: string): string {
  const compact = userId.replace(/-/g, "").slice(0, 12);
  return `personal-${compact}`;
}

/**
 * Human-friendly meeting / join code (Meet-style), e.g. "k7m-2xq9-p1a".
 * Personal rooms keep their stable `personal-…` id.
 */
export function formatJoinCode(idOrCode: string): string {
  const raw = idOrCode.trim();
  if (!raw) return raw;
  if (raw.toLowerCase().startsWith("personal-")) return raw.toLowerCase();

  const compact = raw.replace(/-/g, "").toLowerCase();
  if (!/^[a-z0-9]{10}$/.test(compact)) return raw;
  return `${compact.slice(0, 3)}-${compact.slice(3, 7)}-${compact.slice(7)}`;
}

export function compactMeetingCode(idOrCode: string): string {
  const raw = idOrCode.trim();
  if (!raw) return raw;
  if (raw.toLowerCase().startsWith("personal-")) return raw.toLowerCase();
  return raw.replace(/-/g, "").toLowerCase();
}

/** Path segment used in shareable links. */
export function meetingLobbyPath(idOrCode: string): string {
  return `/meeting/${formatJoinCode(idOrCode)}/lobby`;
}

export function buildMeetingJoinUrl(baseUrl: string, idOrCode: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${meetingLobbyPath(idOrCode)}`;
}

/**
 * PostgREST `.or()` filter so callers can pass either room id or dashed join code.
 */
export function roomLookupOrFilter(roomId: string): string {
  const raw = decodeURIComponent(roomId.trim());
  const variants = new Set<string>();
  variants.add(raw);
  variants.add(raw.toLowerCase());

  if (!raw.toLowerCase().startsWith("personal-")) {
    const compact = compactMeetingCode(raw);
    const formatted = formatJoinCode(compact);
    variants.add(compact);
    variants.add(formatted);
  } else {
    variants.add(raw.toLowerCase());
  }

  return Array.from(variants)
    .flatMap((v) => [`id.eq.${v}`, `join_code.eq.${v}`])
    .join(",");
}
