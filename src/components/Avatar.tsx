export const AVATARS = ['🦊','🐙','🐸','🦉','🐢','🦝','🐧','🦋','🐝','🦀','🐳','🦔'];

export function Avatar({ i, size = 28 }: { i: number; size?: number }) {
  return (
    <span className="avatar" style={{ fontSize: size, lineHeight: 1 }}>
      {AVATARS[i % AVATARS.length]}
    </span>
  );
}
