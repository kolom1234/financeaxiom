export function SourceBadge({ source }: { source: { name: string } }): JSX.Element {
  return (
    <span className="badge badge-source" aria-label={`Source ${source.name}`}>
      {source.name}
    </span>
  );
}

