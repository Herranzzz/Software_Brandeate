import { PlaceholderPage } from "@/components/placeholder-page";
import { requireAdminUser } from "@/lib/auth";


export default async function InventarioPage() {
  await requireAdminUser();
  return (
    <PlaceholderPage
      eyebrow="Inventario"
      title="Control de stock"
      description="Vista futura para niveles de inventario, reservas y alertas de reposicion."
    />
  );
}
