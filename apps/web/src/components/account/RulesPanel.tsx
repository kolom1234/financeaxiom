import { useState } from "react";
import type { AlertRule } from "../../lib/accountApi";

const RULE_LABEL: Record<AlertRule["rule_type"], string> = {
  breaking: "All breaking items",
  macro: "Macro updates",
  entity: "Entity",
  ticker: "Ticker",
  filing_form: "SEC form"
};

function describeRule(rule: AlertRule): string {
  const value = rule.rule.slug ?? rule.rule.ticker ?? rule.rule.form_type;
  return typeof value === "string" ? `${RULE_LABEL[rule.rule_type]}: ${value}` : RULE_LABEL[rule.rule_type];
}

export interface NewRuleInput {
  rule_type: AlertRule["rule_type"];
  value: string;
}

export function RulesPanel({
  rules,
  busy,
  onLoad,
  onAddBreaking,
  onAdd,
  onDelete
}: {
  rules: AlertRule[];
  busy: boolean;
  onLoad: () => void;
  onAddBreaking: () => void;
  onAdd: (input: NewRuleInput) => void;
  onDelete: (ruleId: string) => void;
}): JSX.Element {
  const [ruleType, setRuleType] = useState<AlertRule["rule_type"]>("ticker");
  const [value, setValue] = useState("");
  const needsValue = ruleType === "ticker" || ruleType === "entity" || ruleType === "filing_form";

  return (
    <section className="glass-panel card-stack">
      <h2>Alert rules</h2>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={onLoad} disabled={busy}>
          Load Rules
        </button>
        <button type="button" className="btn btn-ghost" onClick={onAddBreaking} disabled={busy}>
          Add Breaking Rule
        </button>
      </div>
      <form
        className="row-actions"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd({ rule_type: ruleType, value: value.trim() });
          setValue("");
        }}
      >
        <label>
          Rule type
          <select value={ruleType} onChange={(event) => setRuleType(event.target.value as AlertRule["rule_type"])} disabled={busy}>
            <option value="ticker">Ticker (e.g. NVDA)</option>
            <option value="entity">Entity slug (e.g. nvidia)</option>
            <option value="filing_form">SEC form (e.g. 8-K)</option>
            <option value="macro">Macro updates</option>
            <option value="breaking">All breaking items</option>
          </select>
        </label>
        {needsValue ? (
          <label>
            Value
            <input value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} required={ruleType !== "filing_form"} />
          </label>
        ) : null}
        <button type="submit" className="btn btn-ghost" disabled={busy}>
          Add rule
        </button>
      </form>
      {rules.length === 0 ? (
        <p className="muted-copy">No rules loaded.</p>
      ) : (
        <ul className="card-stack" aria-label="Alert rules">
          {rules.map((rule) => (
            <li key={rule.rule_id} data-rule-id={rule.rule_id} className="row-actions">
              <span>
                {describeRule(rule)}
                {rule.enabled ? "" : " (paused)"}
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => onDelete(rule.rule_id)} disabled={busy}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
