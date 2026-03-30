import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { TenantShell } from "@/components/tenant-shell";
import { fetchShopById } from "@/lib/api";


type TenantLayoutProps = {
  children: ReactNode;
  params: Promise<{ shopId: string }>;
};


export default async function TenantLayout({ children, params }: TenantLayoutProps) {
  const { shopId } = await params;
  const shop = await fetchShopById(shopId);

  if (!shop) {
    notFound();
  }

  return <TenantShell shop={shop}>{children}</TenantShell>;
}
