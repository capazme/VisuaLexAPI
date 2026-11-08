/**
 * Length checks in UTF-16 units, as zod 3 counted and as the server's own `.length` checks and the web's
 * `maxlength` still count. zod 4's `.min`/`.max` count code points, so a character outside the basic plane
 * (an emoji) counts once there and twice here. Used where a limit must not move: one checked again with
 * `.length` elsewhere, and the passwords. The messages are zod 4's own for `.min`/`.max`.
 */
export const atMostUnits = (max: number) =>
  [(value: string) => value.length <= max, `Too big: expected string to have <=${max} characters`] as const;

export const atLeastUnits = (min: number) =>
  [(value: string) => value.length >= min, `Too small: expected string to have >=${min} characters`] as const;
