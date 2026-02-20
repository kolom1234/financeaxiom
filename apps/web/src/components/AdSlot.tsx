import { useEffect, useMemo, useState } from "react";
import { useConsent, type RegionPolicy } from "../state/consent";

interface AdSlotProps {
  slotId: string;
}

interface CmpSignals {
  tcfString: string | null;
  gppString: string | null;
  usPrivacyString: string | null;
}

const EMPTY_SIGNALS: CmpSignals = {
  tcfString: null,
  gppString: null,
  usPrivacyString: null
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  return input as Record<string, unknown>;
}

function normalizeSignal(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const normalized = input.trim();
  return normalized.length > 0 ? normalized : null;
}

async function readTcfString(timeoutMs = 700): Promise<string | null> {
  const api = (window as Window & { __tcfapi?: (...args: unknown[]) => void }).__tcfapi;
  if (typeof api !== "function") {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    try {
      api("getTCData", 2, (payload: unknown, success: unknown) => {
        window.clearTimeout(timeout);
        if (success !== true) {
          finish(null);
          return;
        }
        const record = asRecord(payload);
        finish(normalizeSignal(record?.tcString));
      });
    } catch {
      window.clearTimeout(timeout);
      finish(null);
    }
  });
}

async function readGppString(timeoutMs = 700): Promise<string | null> {
  const api = (window as Window & { __gpp?: (...args: unknown[]) => void }).__gpp;
  if (typeof api !== "function") {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    try {
      api("getGPPData", (payload: unknown, success: unknown) => {
        window.clearTimeout(timeout);
        if (success === false) {
          finish(null);
          return;
        }
        const record = asRecord(payload);
        finish(normalizeSignal(record?.gppString));
      });
    } catch {
      window.clearTimeout(timeout);
      finish(null);
    }
  });
}

async function readUsPrivacyString(timeoutMs = 700): Promise<string | null> {
  const api = (window as Window & { __uspapi?: (...args: unknown[]) => void }).__uspapi;
  if (typeof api !== "function") {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    try {
      api("getUSPData", 1, (payload: unknown, success: unknown) => {
        window.clearTimeout(timeout);
        if (success !== true) {
          finish(null);
          return;
        }
        if (typeof payload === "string") {
          finish(normalizeSignal(payload));
          return;
        }
        const record = asRecord(payload);
        finish(normalizeSignal(record?.uspString ?? record?.usprivacy));
      });
    } catch {
      window.clearTimeout(timeout);
      finish(null);
    }
  });
}

async function collectCmpSignals(regionPolicy: RegionPolicy): Promise<CmpSignals> {
  if (regionPolicy === "NON_EU") {
    return EMPTY_SIGNALS;
  }

  let latest = EMPTY_SIGNALS;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [tcfString, gppString, usPrivacyString] = await Promise.all([
      readTcfString(),
      readGppString(),
      readUsPrivacyString()
    ]);
    latest = { tcfString, gppString, usPrivacyString };

    if (regionPolicy === "EU_UK_CH" && tcfString) {
      return latest;
    }
    if (regionPolicy === "US_STATE_PRIVACY" && (gppString || usPrivacyString)) {
      return latest;
    }

    if (attempt < 3) {
      await wait(250);
    }
  }

  return latest;
}

function upsertCmpMetadata(script: HTMLScriptElement, regionPolicy: RegionPolicy, signals: CmpSignals): void {
  script.dataset.cmpMode = regionPolicy;

  if (signals.tcfString) {
    script.dataset.ofpCmpTcf = signals.tcfString;
  } else {
    delete script.dataset.ofpCmpTcf;
  }

  if (signals.gppString) {
    script.dataset.ofpCmpGpp = signals.gppString;
  } else {
    delete script.dataset.ofpCmpGpp;
  }

  if (signals.usPrivacyString) {
    script.dataset.ofpCmpUsPrivacy = signals.usPrivacyString;
  } else {
    delete script.dataset.ofpCmpUsPrivacy;
  }
}

function removeSlotScript(slotId: string): void {
  document.querySelector(`script[data-ofp-ad-slot="${slotId}"]`)?.remove();
}

export function AdSlot({ slotId }: AdSlotProps): JSX.Element {
  const { regionPolicy, consent } = useConsent();
  const [cmpSignals, setCmpSignals] = useState<CmpSignals>(EMPTY_SIGNALS);
  const hasAdConsent = consent.ads_personalized || consent.ads_nonpersonalized;

  useEffect(() => {
    let active = true;

    if (!hasAdConsent) {
      setCmpSignals(EMPTY_SIGNALS);
      return () => {
        active = false;
      };
    }

    if (regionPolicy === "NON_EU") {
      setCmpSignals(EMPTY_SIGNALS);
      return () => {
        active = false;
      };
    }

    void collectCmpSignals(regionPolicy).then((signals) => {
      if (active) {
        setCmpSignals(signals);
      }
    });

    return () => {
      active = false;
    };
  }, [hasAdConsent, regionPolicy]);

  const canLoad = useMemo(() => {
    if (!hasAdConsent) {
      return false;
    }
    if (regionPolicy === "EU_UK_CH") {
      return Boolean(cmpSignals.tcfString);
    }
    if (regionPolicy === "US_STATE_PRIVACY") {
      return Boolean(cmpSignals.gppString || cmpSignals.usPrivacyString);
    }
    return true;
  }, [hasAdConsent, regionPolicy, cmpSignals.tcfString, cmpSignals.gppString, cmpSignals.usPrivacyString]);

  useEffect(() => {
    if (!canLoad) {
      removeSlotScript(slotId);
      return;
    }

    const selector = `script[data-ofp-ad-slot="${slotId}"]`;
    const existing = document.querySelector<HTMLScriptElement>(selector);
    if (existing) {
      upsertCmpMetadata(existing, regionPolicy, cmpSignals);
      return () => {
        removeSlotScript(slotId);
      };
    }

    const script = document.createElement("script");
    script.src = "https://example-ad-network.invalid/sdk.js";
    script.async = true;
    script.dataset.ofpAdScript = "1";
    script.dataset.ofpAdSlot = slotId;
    upsertCmpMetadata(script, regionPolicy, cmpSignals);
    document.body.appendChild(script);

    return () => {
      removeSlotScript(slotId);
    };
  }, [canLoad, slotId, regionPolicy, cmpSignals.tcfString, cmpSignals.gppString, cmpSignals.usPrivacyString]);

  const statusText = useMemo(() => {
    if (!canLoad) {
      if (!hasAdConsent) {
        return "Consent pending. Script blocked.";
      }
      if (regionPolicy === "EU_UK_CH") {
        return "CMP signal missing. Script blocked.";
      }
      if (regionPolicy === "US_STATE_PRIVACY") {
        return "US privacy signal missing. Script blocked.";
      }
      return "Consent pending. Script blocked.";
    }
    return "Consent granted. Script loaded.";
  }, [canLoad, hasAdConsent, regionPolicy]);

  return (
    <aside className="ad-slot glass-panel" aria-label="Advertisement area">
      <p className="ad-label">Ad Slot</p>
      <p className="ad-status">{statusText}</p>
    </aside>
  );
}
