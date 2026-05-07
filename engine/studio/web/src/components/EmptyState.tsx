export function EmptyState({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 ${className}`}>
      <div className="font-hand text-2xl text-graphite">{children}</div>
    </div>
  );
}
