export const AVATARS = ['🦊', '🐙', '🐸', '🦉', '🐢', '🦝', '🐧', '🦋', '🐝', '🦀', '🐳', '🦔'];

/** Each avatar sits on its own marker colour, so players are told apart at a glance. */
export const BACKDROPS = [
  '#ffd23f', '#ff9ec7', '#9df0bd', '#c3b8ff', '#8fe3ff', '#ffb27a',
  '#fff07a', '#ffc2e0', '#b6f5cf', '#d9d1ff', '#a6ecff', '#ffd0a6',
];

/**
 * Which emoji and backdrop an avatar number shows; any integer maps onto one.
 * The share card goes through this too, so it draws exactly what the screen shows.
 */
export function avatarSlot(i: number): number {
  return ((i % AVATARS.length) + AVATARS.length) % AVATARS.length;
}

export function Avatar({ i, size = 36 }: { i: number; size?: number }) {
  const k = avatarSlot(i);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.58, background: BACKDROPS[k] }}
      aria-hidden="true"
    >
      {AVATARS[k]}
    </span>
  );
}
