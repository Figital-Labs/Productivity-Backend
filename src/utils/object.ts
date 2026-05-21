/**
 * Drops keys whose values are `undefined` and strips `undefined` from the
 * inferred value types. Needed at the Prisma boundary because
 * `exactOptionalPropertyTypes` rejects `{ foo: undefined }` for fields whose
 * generated input type is `foo?: T` (no implicit undefined).
 *
 * `null` values are preserved — they are meaningful as "clear this field" in
 * Prisma update inputs.
 */
type StripUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function omitUndefined<T extends object>(obj: T): StripUndefined<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as StripUndefined<T>;
}
