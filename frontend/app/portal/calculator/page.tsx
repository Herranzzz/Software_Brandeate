import { PageHeader } from "@/components/page-header";
import { PortalShippingCalculator } from "@/components/portal-shipping-calculator";
import { requirePortalUser } from "@/lib/auth";

export default async function PortalCalculatorPage() {
  await requirePortalUser();

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Calculadora"
        title="Simulador de costes de envío"
        description="Compara carriers y servicios antes de enviar. Pensado para que puedas cotizar nuevos productos o mercados en segundos."
      />
      <PortalShippingCalculator />
    </div>
  );
}
