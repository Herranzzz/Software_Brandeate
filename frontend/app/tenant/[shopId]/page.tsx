import { redirect } from "next/navigation";


type TenantEntryPageProps = {
  params: Promise<{ shopId: string }>;
};


export default async function TenantEntryPage({ params }: TenantEntryPageProps) {
  const { shopId } = await params;
  redirect(`/tenant/${shopId}/dashboard`);
}
