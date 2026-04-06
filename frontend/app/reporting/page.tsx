import { redirect } from "next/navigation";

type ReportingPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function buildQuery(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export default async function AdminReportingPage({ searchParams }: ReportingPageProps) {
  const params = await searchParams;
  redirect(`/shipments${buildQuery(params)}`);
}
