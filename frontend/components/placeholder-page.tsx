import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";


type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
};


export function PlaceholderPage({
  eyebrow,
  title,
  description,
}: PlaceholderPageProps) {
  return (
    <div className="stack">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Card className="stack">
        <div className="placeholder-panel">
          <h3 className="section-title section-title-small">En preparacion</h3>
          <p className="subtitle">
            Esta seccion queda lista en la navegacion para el siguiente paso del MVP.
          </p>
        </div>
      </Card>
    </div>
  );
}
