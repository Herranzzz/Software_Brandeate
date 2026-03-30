import { redirect } from "next/navigation";


type TenantDashboardEntryProps = {
  params: Promise<{ shopId: string }>;
};


export default async function TenantDashboardEntry({ params }: TenantDashboardEntryProps) {
  const { shopId } = await params;
  redirect(`/tenant/${shopId}/dashboard/overview`);
}
