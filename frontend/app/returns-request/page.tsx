import { ReturnRequestForm } from "@/components/return-request-form";

export const metadata = {
  title: "Solicitar devoluci\u00f3n",
  description: "Solicita la devoluci\u00f3n de tu pedido",
};

export default function ReturnsRequestPage() {
  return (
    <div className="return-request-page">
      <div className="return-request-container">
        <div className="return-request-header">
          <h1 className="return-request-title">Solicitar devoluci&oacute;n</h1>
          <p className="return-request-subtitle">
            Introduce los datos de tu pedido para iniciar el proceso de devoluci&oacute;n. Recibir&aacute;s instrucciones por email.
          </p>
        </div>
        <ReturnRequestForm />
        <div className="return-request-footer">
          Powered by <strong>Brandeate</strong>
        </div>
      </div>
    </div>
  );
}
