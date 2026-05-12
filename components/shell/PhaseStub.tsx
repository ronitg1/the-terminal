export function PhaseStub({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-md border border-dashed text-center">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Phase 2</div>
      <div className="mt-1 text-lg font-semibold">{title}</div>
      <div className="mt-1 max-w-md text-xs text-muted-foreground">{description}</div>
    </div>
  );
}
