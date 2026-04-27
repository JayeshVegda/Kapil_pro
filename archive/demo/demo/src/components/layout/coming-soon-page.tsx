export function ComingSoonPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="w-full px-4 pb-8 pt-4 md:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </section>
    </div>
  )
}
