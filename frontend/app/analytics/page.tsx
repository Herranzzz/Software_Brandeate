import { redirect } from "next/navigation";


type AnalyticsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};


function buildQuery(params: Record<string, string | string[] | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry) {
          searchParams.append(key, entry);
        }
      }
      continue;
    }

    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query ? `/shipments?${query}` : "/shipments";
}


export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const params = (await searchParams) ?? {};
  redirect(buildQuery(params));
}
