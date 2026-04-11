import { InvoicesPanel } from "@/components/invoices-panel";
import { fetchInvoices, fetchShops } from "@/lib/api";
import { requireAdminUser } from "@/lib/auth";
import type { InvoiceStatus } from "@/lib/types";


type InvoicesPageProps = {
  searchParams: Promise<{
    status?: string;
    q?: string;
  }>;
};


function resolveStatus(value?: string): InvoiceStatus | undefined {
  const valid: InvoiceStatus[] = ["draft", "sent", "paid", "cancelled"];
  return valid.includes(value as InvoiceStatus) ? (value as InvoiceStatus) : undefined;
}


export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const params = await searchParams;
  const status = resolveStatus(params.status);

  const [userResult, invoicesResult, shopsResult] = await Promise.allSettled([
    requireAdminUser(),
    fetchInvoices({ status, q: params.q }),
    fetchShops(),
  ]);

  if (userResult.status === "rejected") throw userResult.reason;

  const invoices = invoicesResult.status === "fulfilled" ? invoicesResult.value : [];
  const shops = shopsResult.status === "fulfilled" ? shopsResult.value : [];

  return (
    <InvoicesPanel
      initialInvoices={invoices}
      shops={shops}
      initialStatus={status}
      initialQ={params.q}
    />
  );
}
