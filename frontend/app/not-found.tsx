import Link from "next/link";

export default function NotFound() {
  return (
    <main className="public-shell">
      <div className="app-shell">
        <section className="card stack" style={{ maxWidth: 560, margin: "64px auto" }}>
          <span className="eyebrow">404</span>
          <h1 className="section-title">Esta página no existe</h1>
          <p className="subtitle">
            La ruta que intentabas abrir no está disponible o ya no forma parte de la aplicación.
          </p>
          <div className="admin-dashboard-note-actions">
            <Link className="button" href="/dashboard">
              Ir al dashboard
            </Link>
            <Link className="button button-secondary" href="/orders">
              Ver pedidos
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
