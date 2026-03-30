import { redirect } from "next/navigation";


export default function PortalIncidenciasRedirectPage() {
  redirect("/portal/operations?view=incidents");
}
