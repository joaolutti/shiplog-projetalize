/**
 * Shipped feed (M4): filters for date, branch, label, developer, requester and
 * verification status. No per-developer aggregates (SCOPE.md §2).
 */
export default function FeedPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Shiplog</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Shipped feed: scaffold only. See SCOPE.md, milestone M4.
      </p>
    </main>
  );
}
