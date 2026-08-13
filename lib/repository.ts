import { offerings, uniqueCanonicalAccountCount } from "@/lib/data";
import { createSlackAlert, generateOutreachMock, matchOfferingMock } from "@/lib/recommendations";
import { scoreAccount } from "@/lib/scoring";
import { getSessionAccounts } from "@/lib/session-store";
import type { Account, AccountDetail, OutreachDraft } from "@/lib/schemas";

export function getAccount(id: string, items = getSessionAccounts()) {
  return items.find((account) => account.id === id);
}

export function getAccountDetail(id: string, tone: OutreachDraft["tone"] = "Direct", items = getSessionAccounts()): AccountDetail | undefined {
  const account = items.find((item) => item.id === id);
  if (!account) return undefined;
  const score = scoreAccount(account);
  const recommendation = matchOfferingMock(account, offerings);
  const outreach = generateOutreachMock(account, recommendation, tone);
  const slack = createSlackAlert(account, score.total, recommendation);
  return { account, score, recommendation, outreach, slack };
}

export function listAccountDetails(items: Account[] = getSessionAccounts()): AccountDetail[] {
  return items.map((account) => getAccountDetail(account.id, "Direct", items)!).sort((a, b) => b.score.total - a.score.total || a.account.name.localeCompare(b.account.name));
}

export function accountMetrics(items: Account[] = getSessionAccounts()) {
  const details = listAccountDetails(items);
  return {
    rows: details.length,
    canonicalAccounts: uniqueCanonicalAccountCount(items),
    pursueNow: details.filter((item) => item.score.total >= 80 && !item.account.duplicateOf).length,
  };
}
