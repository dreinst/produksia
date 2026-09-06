export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Memuat">
      <div className="h-6 w-48 rounded bg-zinc-200" />
      <div className="h-32 rounded bg-zinc-100" />
      <div className="h-64 rounded bg-zinc-100" />
    </div>
  );
}
