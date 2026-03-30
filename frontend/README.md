# Frontend

Frontend minimo del MVP en Next.js App Router para operar pedidos y consultar tracking publico.

## Requisitos

- Node.js 20 o superior
- Backend FastAPI corriendo en `http://localhost:8000`

## Variables de entorno

Crea `frontend/.env.local` con:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Si no se define, el frontend usa `http://localhost:8000` por defecto.

## Instalar dependencias

```bash
cd frontend
npm install
```

## Arrancar en desarrollo

```bash
cd frontend
npm run dev
```

Abre:

- `http://localhost:3000/orders`
- `http://localhost:3000/tracking/[token]`

## Pantallas incluidas

- `/orders`: listado con filtros por `status` y `production_status`
- `/orders/[id]`: detalle del pedido con items, shipment, tracking events y acciones para actualizar estados
- `/tracking/[token]`: pantalla publica de seguimiento

## Notas

- Las lecturas usan `fetch` simple desde componentes del App Router.
- Los `PATCH` pasan por route handlers de Next para evitar problemas de CORS en navegador.
