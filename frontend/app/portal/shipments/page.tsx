import { redirect } from "next/navigation";


export default function PortalShipmentsRedirectPage() {
  redirect("/portal/operations?view=shipments");
}
