export type CallPolicyInput = {
  direction: "inbound" | "outbound";
  consent: boolean;
  doNotCall: boolean;
  localHour: number;
  jurisdiction: string;
};

export type PolicyDecision = { allowed: boolean; reasons: string[] };

export function evaluateCallPolicy(input: CallPolicyInput): PolicyDecision {
  const reasons: string[] = [];
  if (input.direction === "outbound") {
    if (!input.consent) reasons.push("missing_consent");
    if (input.doNotCall) reasons.push("do_not_call");
    if (input.localHour < 8 || input.localHour >= 21) reasons.push("outside_calling_window");
  }
  if (!input.jurisdiction.trim()) reasons.push("unknown_jurisdiction");
  return { allowed: reasons.length === 0, reasons };
}
