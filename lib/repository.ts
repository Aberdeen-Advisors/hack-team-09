import { accounts, offerings, uniqueCanonicalAccountCount } from "@/lib/data";
import { createSlackAlert, generateOutreachMock, matchOfferingMock } from "@/lib/recommendations";
import { scoreAccount } from "@/lib/scoring";
import type { AccountDetail, OutreachDraft } from "@/lib/schemas";

export function getAccount(id: string) {
  return accounts.find((account) => account.id === id);
}

export function getAccountDetail(id: string, tone: OutreachDraft["tone"] = "Direct"): AccountDetail | undefined {
  const account = getAccount(id);
  if (!account) return undefined;
  const score = scoreAccount(account);
  const recommendation = matchOfferingMock(account, offerings);
  const outreach = generateOutreachMock(account, recommendation, tone);
  const slack = createSlackAlert(account, score.total, recommendation);
  return { account, score, recommendation, outreach, slack };
}

export function listAccountDetails(): AccountDetail[] {
  return accounts.map((account) => getAccountDetail(account.id)!).sort((a, b) => b.score.total - a.score.total || a.account.name.localeCompare(b.account.name));
}

export function accountMetrics() {
  const details = listAccountDetails();
  return {
    rows: details.length,
    canonicalAccounts: uniqueCanonicalAccountCount(),
    pursueNow: details.filter((item) => item.score.total >= 80 && !item.account.duplicateOf).length,
  };
}
