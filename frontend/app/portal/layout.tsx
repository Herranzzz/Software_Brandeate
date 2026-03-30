import type { ReactNode } from "react";

import { PortalShell } from "@/components/portal-shell";
import { fetchMyShops, requirePortalUser } from "@/lib/auth";


type PortalLayoutProps = {
  children: ReactNode;
};


export default async function PortalLayout({ children }: PortalLayoutProps) {
  const user = await requirePortalUser();
  const shops = await fetchMyShops();

  return <PortalShell shops={shops} user={user}>{children}</PortalShell>;
}
