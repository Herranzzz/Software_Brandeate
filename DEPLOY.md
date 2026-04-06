# Deploy

Guía para desplegar:

- frontend Next.js en Vercel
- backend FastAPI en Render

La arquitectura final queda así:

- Vercel sirve el frontend
- Render sirve la API FastAPI
- Postgres vive en Render o en un proveedor externo
- el frontend habla con el backend usando `NEXT_PUBLIC_API_URL`

## 1. Variables de entorno

### Frontend (`frontend`)

Necesaria:

```env
NEXT_PUBLIC_API_URL=https://tu-backend.onrender.com
```

En local puedes usar:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Referencia:

- [frontend/.env.example](/Users/jorge/Documents/3pl-piloto/frontend/.env.example)

### Backend (`backend`)

Mínimas recomendadas:

```env
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME
AUTH_SECRET=un-secreto-largo-y-aleatorio
SHOPIFY_SYNC_ENABLED=true
SHOPIFY_SYNC_INTERVAL_MINUTES=5
SHOPIFY_SYNC_MAX_ORDERS=5000
SHOPIFY_SSL_VERIFY=true
```

Opcionales:

```env
SHOPIFY_WEBHOOK_SECRET=
SHOPIFY_SSL_CAFILE=
```

Referencia:

- [backend/.env.example](/Users/jorge/Documents/3pl-piloto/backend/.env.example)

## 2. Desplegar el backend en Render

### Opción recomendada: usando `render.yaml`

El repo ya incluye:

- [render.yaml](/Users/jorge/Documents/3pl-piloto/render.yaml)
- [backend/start.sh](/Users/jorge/Documents/3pl-piloto/backend/start.sh)
- [backend/worker.py](/Users/jorge/Documents/3pl-piloto/backend/worker.py)

`start.sh` usa el `PORT` dinámico que Render inyecta:

```sh
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

### Pasos

1. Sube el proyecto a GitHub.
2. En Render, crea un nuevo `Web Service` desde ese repositorio.
3. Render detectará `render.yaml`. Si no lo hace, configura manualmente:

```txt
Root Directory: backend
Build Command: pip install -r requirements.txt
Start Command: ./start.sh
```

4. Añade variables de entorno:
   - `DATABASE_URL`
   - `AUTH_SECRET`
   - `CORS_ORIGINS`
   - `SHOPIFY_WEBHOOK_SECRET` si lo usas
   - credenciales de CTT (`CTT_CLIENT_ID`, `CTT_CLIENT_SECRET`, etc.)

5. Despliega.

### Arquitectura recomendada en Render

El `render.yaml` queda preparado para dos procesos:

- `3pl-piloto-backend`:
  - sirve la API FastAPI
  - expone `/health`
  - **no** ejecuta schedulers en el proceso web
- `3pl-piloto-background-worker`:
  - ejecuta el scheduler de Shopify
  - ejecuta la sincronización automática de tracking CTT

Así evitamos duplicar tareas de background en múltiples réplicas del servidor web.

### Health check

El backend expone:

```txt
GET /health
```

Ejemplo:

```bash
curl https://tu-backend.onrender.com/health
```

Respuesta esperada:

```json
{"ok":true}
```

## 3. Ejecutar migraciones Alembic

Render no ejecuta migraciones automáticamente con esta configuración.

Tienes dos caminos:

### Opción A: desde local contra la base de producción

```bash
cd backend
source .venv/bin/activate
DATABASE_URL="postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME" alembic upgrade head
```

### Opción B: shell de Render

Abre un shell en Render y ejecuta:

```bash
cd /opt/render/project/src/backend
alembic upgrade head
```

Si prefieres automatizar esto después, se puede añadir un job de migraciones separado.

## 4. Desplegar el frontend en Vercel

### Pasos

1. En Vercel, importa el repositorio.
2. Configura:

```txt
Root Directory: frontend
Framework Preset: Next.js
Build Command: npm run build
Install Command: npm install
```

Nota:

- El [frontend/vercel.json](/Users/jorge/Documents/3pl-piloto/frontend/vercel.json) está preparado para ese `Root Directory`.
- Si en Vercel dejas la raíz en `frontend`, **no** hace falta `cd frontend` en los comandos.

3. Añade la variable:

```env
NEXT_PUBLIC_API_URL=https://tu-backend.onrender.com
```

4. Despliega.

## 5. Conectar frontend y backend

Una vez tengas ambas URLs:

1. copia la URL pública del backend de Render
2. pégala en `NEXT_PUBLIC_API_URL` en Vercel
3. vuelve a desplegar el frontend si cambiaste la variable

Ejemplo:

```env
NEXT_PUBLIC_API_URL=https://3pl-piloto-backend.onrender.com
```

## 6. Checklist de producción

Antes de darlo por cerrado:

1. backend responde en `/health`
2. login funciona
3. `/orders` carga correctamente
4. `/dashboard` y `/shipments` cargan correctamente
5. `/tracking/[token]` responde en público
6. Shopify sync manual funciona
7. el worker de Render está corriendo
8. tracking CTT se sincroniza automáticamente en producción

## 7. Notas importantes

- El frontend ya usa `NEXT_PUBLIC_API_URL` correctamente en [frontend/lib/api.ts](/Users/jorge/Documents/3pl-piloto/frontend/lib/api.ts).
- En producción, si falta `NEXT_PUBLIC_API_URL`, ahora falla con un error explícito en lugar de intentar usar `localhost`.
- El backend ya está preparado para `PORT` dinámico con [backend/start.sh](/Users/jorge/Documents/3pl-piloto/backend/start.sh).
- El endpoint de health está en [backend/app/api/routes/health.py](/Users/jorge/Documents/3pl-piloto/backend/app/api/routes/health.py).

## 8. Siguiente mejora opcional

Cuando quieras, el siguiente paso natural sería añadir:

- un `Background Worker` para tareas Shopify separadas del proceso web
- migraciones automáticas en CI/CD
- dominio propio para frontend y backend
