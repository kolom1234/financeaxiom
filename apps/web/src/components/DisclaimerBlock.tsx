import { notInvestmentAdviceText } from "@ofp/shared";

export function DisclaimerBlock(): JSX.Element {
  return (
    <p className="disclaimer" role="note">
      {notInvestmentAdviceText()}
    </p>
  );
}

