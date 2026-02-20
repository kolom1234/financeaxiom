import { useEffect, useState } from "react";
import { getLegal } from "../lib/api";
import { DisclaimerBlock } from "../components/DisclaimerBlock";

export function LegalPage(): JSX.Element {
  const [payload, setPayload] = useState<Record<string, unknown>>({});

  useEffect(() => {
    let active = true;
    void getLegal().then((data) => {
      if (active) {
        setPayload(data);
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
      <pre className="json-block glass-panel">{JSON.stringify(payload, null, 2)}</pre>
      <DisclaimerBlock />
    </section>
  );
}

