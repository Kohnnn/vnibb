'use client'

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto flex max-w-[1600px] animate-pulse gap-4 px-4 py-4 lg:px-6">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/70 p-4">
            <div className="h-5 w-32 rounded bg-[var(--bg-tertiary)]" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} className="h-10 rounded-xl bg-[var(--bg-tertiary)]" />
              ))}
            </div>
          </div>
        </aside>

        <main className="flex-1 space-y-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <div className="h-6 w-40 rounded bg-[var(--bg-tertiary)]" />
                <div className="h-3 w-56 rounded bg-[var(--bg-tertiary)]" />
              </div>
              <div className="h-10 w-40 rounded-xl bg-[var(--bg-tertiary)]" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/70 p-4 xl:col-span-4">
              <div className="h-4 w-24 rounded bg-[var(--bg-tertiary)]" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-16 rounded-xl bg-[var(--bg-tertiary)]" />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/70 p-4 xl:col-span-8">
              <div className="h-4 w-28 rounded bg-[var(--bg-tertiary)]" />
              <div className="mt-4 h-[320px] rounded-2xl bg-[var(--bg-tertiary)]" />
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/70 p-4 xl:col-span-12">
              <div className="h-4 w-32 rounded bg-[var(--bg-tertiary)]" />
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-24 rounded-xl bg-[var(--bg-tertiary)]" />
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
