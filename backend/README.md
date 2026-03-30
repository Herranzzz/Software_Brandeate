# Backend

Base de backend con FastAPI, SQLAlchemy y Alembic lista para correr en Docker.

## Estructura

- `app/main.py`: arranque de FastAPI
- `app/api/routes.py`: endpoint `GET /health`
- `app/core/config.py`: carga de configuración desde entorno
- `app/db/`: base declarativa y sesión SQLAlchemy
- `alembic/`: configuración y migraciones

## Variables de entorno

El backend usa `DATABASE_URL` para conectarse a Postgres.

Ejemplo:

```env
DATABASE_URL=postgresql+psycopg://postgres:postgres@db:5432/app
```

Puedes copiar el ejemplo:

```bash
cp .env.example .env
```

## Levantar en local con Python

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Healthcheck:

```bash
curl http://localhost:8000/health
```

Respuesta esperada:

```json
{"ok":true}
```

## Build y run con Docker

```bash
docker build -t 3pl-backend ./backend
docker run --rm -p 8000:8000 --env-file ./backend/.env 3pl-backend
```

Si quieres ejecutar migraciones antes de arrancar el servidor:

```bash
docker run --rm --env-file ./backend/.env 3pl-backend alembic upgrade head
docker run --rm -p 8000:8000 --env-file ./backend/.env 3pl-backend
```

## Migraciones

Migración inicial incluida en:

`alembic/versions/0001_initial.py`

Crear una nueva migración:

```bash
alembic revision --autogenerate -m "describe_change"
```

Aplicar migraciones:

```bash
alembic upgrade head
```
