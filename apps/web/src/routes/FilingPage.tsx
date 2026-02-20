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

  useEffect(() => {
    let active = true;
    void getFiling(accession).then((data) => {
      if (active) {
        setFiling(data);
      }
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
        <p>Company: {String(filing.company_name ?? "Unknown")}</p>
        <p>Form: {String(filing.form_type ?? "N/A")}</p>
        <a href={secUrl} target="_blank" rel="noopener noreferrer" className="external-link">
          Open on SEC.gov
        </a>
      </article>
    </section>
  );
}
