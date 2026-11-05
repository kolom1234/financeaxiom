import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getFiling } from "../lib/api";

function normalizeExternalUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "https://www.sec.gov/";
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "https://www.sec.gov/";
    }
    return parsed.toString();
  } catch {
    return "https://www.sec.gov/";
  }
}

export function FilingPage(): JSX.Element {
  const { accession = "" } = useParams();
  const [filing, setFiling] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<"loading" | "ok" | "not_found" | "error">("loading");

  useEffect(() => {
    let active = true;
    setState("loading");
    void getFiling(accession).then((result) => {
      if (!active) {
        return;
      }
      setState(result.status);
      setFiling(result.status === "ok" ? result.data : {});
    });
    return () => {
      active = false;
    };
  }, [accession]);

  const secUrl = normalizeExternalUrl(filing.sec_url);

  return (
    <section className="page-wrap">
      <header className="glass-panel page-header">
        <h1>SEC Filing</h1>
        <p className="muted-copy">Metadata only. No filing text is republished.</p>
      </header>
      <article className="glass-panel card-stack">
        <p>Accession: {accession}</p>
        {state === "not_found" ? <p role="alert">This filing is not in our index. You can still look it up on SEC.gov.</p> : null}
        {state === "error" ? <p role="alert">Filing metadata is temporarily unavailable.</p> : null}
        {state === "ok" ? (
          <>
            <p>Company: {String(filing.company_name ?? "Unknown")}</p>
            <p>Form: {String(filing.form_type ?? "N/A")}</p>
            {filing.accepted_at ? <p>Accepted: {String(filing.accepted_at)}</p> : null}
            <p className="feed-footnote">{String((filing.license as { attribution_text?: string } | undefined)?.attribution_text ?? "Source: SEC EDGAR (official).")}</p>
          </>
        ) : null}
        <a href={secUrl} target="_blank" rel="noopener noreferrer" className="external-link">
          Open on SEC.gov
        </a>
      </article>
    </section>
  );
}
