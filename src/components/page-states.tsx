export function PageSkeleton() {
  return (
    <div aria-label="Loading treasury workspace" role="status" className="animate-pulse">
      <div className="ink-grid h-56" />
      <div className="mx-auto grid max-w-[1440px] gap-4 px-5 py-8 md:grid-cols-2 md:px-8 xl:grid-cols-4 lg:px-10">
        {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-36 border border-white/10 bg-white/[0.05]" />)}
      </div>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-8 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-white/60">{description}</p>
    </div>
  );
}
