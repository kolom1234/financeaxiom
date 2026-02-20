export function LicenseBadge({
  license
}: {
  license: { code: string; commercial_status: "allowed" | "conditional" | "disallowed" };
}): JSX.Element {
  return (
    <span className={`badge badge-license status-${license.commercial_status}`} aria-label={`License ${license.code}`}>
      {license.code}
    </span>
  );
}

