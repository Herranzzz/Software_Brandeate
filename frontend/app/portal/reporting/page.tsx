import { redirect } from "next/navigation";

type PortalReportingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildQuery(params: Record<string, string | string[] | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const normalized = readValue(value);
    if (normalized) {
      searchParams.set(key, normalized);
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export default async function PortalReportingPage({ searchParams }: PortalReportingPageProps) {
  const params = (await searchParams) ?? {};
  redirect(`/portal/shipments${buildQuery(params)}`);
}
