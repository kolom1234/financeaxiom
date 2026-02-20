import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

const SOURCE_PREVIEW_PARAMS = {
  title: "title",
  mentions: "mentions",
  sources: "sources",
  query: "query",
  external: "external"
} as const;

function isValidHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeCount(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function countLabel(label: string, value: number | null): string {
  return `${label} ${value === null ? "n/a" : value.toLocaleString("en-US")}`;
}

export function GdeltSourcePage(): JSX.Element {
  const [searchParams] = useSearchParams();

  const title = useMemo(() => {
    const value = searchParams.get(SOURCE_PREVIEW_PARAMS.title);
    return value && value.trim().length > 0 ? value.trim() : "Index Signal";
  }, [searchParams]);

  const query = useMemo(() => {
    const value = searchParams.get(SOURCE_PREVIEW_PARAMS.query);
    return value && value.trim().length > 0 ? value.trim() : null;
  }, [searchParams]);

  const mentionCount = useMemo(() => {
    return normalizeCount(searchParams.get(SOURCE_PREVIEW_PARAMS.mentions));
  }, [searchParams]);

  const sourceCount = useMemo(() => {
    return normalizeCount(searchParams.get(SOURCE_PREVIEW_PARAMS.sources));
  }, [searchParams]);

  const externalUrl = useMemo(() => {
    const value = searchParams.get(SOURCE_PREVIEW_PARAMS.external);
    return value ? isValidHttpUrl(value) : null;
  }, [searchParams]);

  return (
    <section className="page-wrap">
      <article className="glass-panel gdelt-preview">
        <header className="gdelt-preview__header">
          <p className="badge">Metadata-Only Source View</p>
          <h1>{title}</h1>
          <p className="muted-copy">Copyright-safe quick view: title and metadata summary only.</p>
        </header>

        <dl className="gdelt-preview__stats">
          <div>
            <dt>Search Query</dt>
            <dd>{query ?? "n/a"}</dd>
          </div>
          <div>
            <dt>Count</dt>
            <dd>{countLabel("count", mentionCount)}</dd>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>{countLabel("sources", sourceCount)}</dd>
          </div>
        </dl>

        {externalUrl ? (
          <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="external-link">
            Open full source on GDELT (external)
          </a>
        ) : (
          <p className="external-link disabled">Open source URL unavailable</p>
        )}
        <p className="gdelt-preview__note muted-copy">
          We do not render publisher headlines or article body.
          <br />
          This view intentionally shows metadata only for compliance and speed.
        </p>
        <Link to="/" className="external-link">
          Return to home
        </Link>
      </article>
    </section>
  );
}

