// Neutral scaffold landing page. It carries no business logic and no reception
// UI — those are built last (Doc 5 §11, Doc 8 Days 5–6). It exists only to prove
// the Next.js app compiles, renders, and styles with Tailwind.
export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Studio Yönetim Asistanı</h1>
        <p className="mt-2 text-sm text-gray-500">
          Phase 1 scaffold — ready for implementation.
        </p>
      </div>
    </main>
  )
}
