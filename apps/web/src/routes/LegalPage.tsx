import { useEffect, useState } from "react";
import { getLegal } from "../lib/api";
import { DisclaimerBlock } from "../components/DisclaimerBlock";

export function LegalPage(): JSX.Element {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getLegal().then((result) => {
      if (!active) {
        return;
      }
      if (result.status === "ok") {
        setPayload(result.data);
        setErrorText(null);
      } else {
        setErrorText(result.status === "error" ? `Source and license data is unavailable: ${result.message}` : "Not found.");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="page-wrap">
      <header className="glass-panel page-header">
        <h1>Sources & Licenses</h1>
        <p className="muted-copy">Auto-generated from license metadata.</p>
      </header>
      {errorText ? (
        <p className="system-banner glass-panel" role="alert">
          {errorText}
        </p>
      ) : (
        <pre className="json-block glass-panel">{payload ? JSON.stringify(payload, null, 2) : "Loading…"}</pre>
      )}
      <DisclaimerBlock />
    </section>
  );
}

