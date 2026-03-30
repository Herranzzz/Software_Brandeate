import Link from "next/link";


export default function OrderNotFound() {
  return (
    <section className="card empty-state">
      <h2>Pedido no encontrado</h2>
      <p className="muted">No pudimos encontrar ese pedido en la API.</p>
      <Link className="button-secondary" href="/orders">
        Volver a pedidos
      </Link>
    </section>
  );
}
