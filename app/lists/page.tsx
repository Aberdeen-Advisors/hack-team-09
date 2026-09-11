import { ListManager } from "@/components/list-manager";
import { listSummaries } from "@/lib/target-lists";
import { integrationStatus } from "@/lib/providers";

export const dynamic = "force-dynamic";
export default async function ListsPage() {
  return <ListManager initialLists={await listSummaries()} initialStatus={await integrationStatus(true)} />;
}
