// Tiny time-sortable, unique id generator (ULID-style ordering without a dependency).
// Lexicographic order matches (timestamp, monotonic counter), so ordering by
// (created_at DESC, id DESC) is stable and unique within and across the same ms.
let counter = 0;

export function newId(ts: number = Date.now()): string {
  counter = (counter + 1) & 0xffffff;
  const t = ts.toString().padStart(15, '0');
  const c = counter.toString(16).padStart(6, '0');
  const r = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `${t}-${c}-${r}`;
}
