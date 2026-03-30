import { redirect } from "next/navigation";


type ProductionPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};


export default async function ProductionPage({ searchParams }: ProductionPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  if (!query.has("quick")) {
    query.set("quick", "not_prepared");
  }

  redirect(`/orders${query.toString() ? `?${query.toString()}` : ""}`);
}
