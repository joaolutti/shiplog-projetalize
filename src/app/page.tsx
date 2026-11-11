/**
 * Shipped feed (M4): filters for date, branch, label, developer, requester and
 * verification status. No per-developer aggregates (SCOPE.md §2).
 */
import { Suspense } from "react";
import { requireViewer } from "@/lib/auth/viewer";

export default function FeedPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Entregas</h1>
      <Suspense fallback={null}>
        <Feed />
      </Suspense>
    </main>
  );
}

async function Feed() {
  await requireViewer();
  return <p className="mt-2 text-sm text-muted">O feed de entregas chega no M4.</p>;
}
