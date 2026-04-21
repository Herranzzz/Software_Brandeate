import { PageHeader } from "@/components/page-header";
import { PortalAddressBook } from "@/components/portal-address-book";
import { requirePortalUser } from "@/lib/auth";

export default async function PortalAddressesPage() {
  await requirePortalUser();

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Libreta"
        title="Direcciones guardadas"
        description="Guarda remitentes y destinatarios frecuentes para crear envíos en un clic y evitar errores de tecleo."
      />
      <PortalAddressBook />
    </div>
  );
}
