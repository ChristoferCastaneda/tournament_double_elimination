# Load test con Locust

Este directorio contiene un load test de [Locust](https://locust.io/) que
recorre **todas las rutas de la API** y simula un torneo de doble eliminación
**desde su creación hasta que hay campeón**.

Cada usuario virtual:

1. Consulta `/health`.
2. Ejerce el ABC de equipos: listar, crear, leer, renombrar y borrar.
3. Ejerce el ABC de torneos: listar, crear, leer, `PUT`, `PATCH` y borrar.
4. Crea, lee, renombra y borra grupos, y asigna equipos.
5. Inicia el torneo con `POST /tournaments/{id}/start`.
6. Consulta los partidos pendientes, reporta un resultado por partido y repite
   hasta que el torneo queda `FINISHED`.
7. Consulta el campeón y valida que sea uno de los equipos inscritos.
8. Crea un torneo `ROUND_ROBIN` pequeño para probar el CRUD de `/matches`
   (`POST`, `GET`, `PATCH score` y `DELETE`), ya que en doble eliminación esos
   endpoints responden `422` a propósito.
9. Borra lo que creó (se puede desactivar con `CLEANUP=0`).

Los casos de error esperados (`400`, `404`, `422`) se validan y se marcan como
éxito para no ensuciar las estadísticas del load test. Cada ruta se agrupa en
las estadísticas con un nombre estable, por ejemplo
`GET /tournaments/{id}/matches`, aunque el id real cambie en cada petición.

## Requisitos

- Python 3.10 o superior.
- La API corriendo.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r loadtest/requirements.txt
```

Si usas el dev container, desde Fedora la API está en
`http://localhost:8081`. Si corres `dotnet run` directo en el host, suele ser
`http://localhost:5075`.

```bash
curl http://localhost:8081/health   # -> "Services running"
```

## Ejecutar con interfaz web

```bash
locust -f loadtest/locustfile.py --host http://localhost:8081
```

Abre `http://localhost:8089`, indica el número de usuarios y la tasa de
generación, y arranca la prueba.

## Ejecutar en modo headless

```bash
locust -f loadtest/locustfile.py --host http://localhost:8081 \
  --headless --users 5 --spawn-rate 1 --run-time 3m \
  --html loadtest/report.html
```

También puedes generar CSV:

```bash
locust -f loadtest/locustfile.py --host http://localhost:8081 \
  --headless --users 10 --spawn-rate 2 --run-time 5m \
  --csv loadtest/resultados
```

## Configuración por variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `API_HOST` | `http://localhost:8081` | Host objetivo si no se usa `--host`. |
| `TEAMS_PER_TOURNAMENT` | `8` | Equipos creados por torneo (mínimo 2). |
| `GROUPS_PER_TOURNAMENT` | `2` | Grupos reales por torneo. |
| `WAIT_MIN` / `WAIT_MAX` | `0.1` / `0.5` | Espera entre ciclos de un usuario, en segundos. |
| `CLEANUP` | `1` | `0` deja los torneos y equipos creados para inspeccionarlos. |

Ejemplo con más equipos y sin limpieza:

```bash
TEAMS_PER_TOURNAMENT=16 GROUPS_PER_TOURNAMENT=4 CLEANUP=0 \
  locust -f loadtest/locustfile.py --host http://localhost:8081
```

## Rutas cubiertas

```text
GET    /health

GET    /teams
POST   /teams
GET    /teams/{id}
PUT    /teams/{id}
DELETE /teams/{id}

GET    /tournaments
POST   /tournaments
GET    /tournaments/{id}
PUT    /tournaments/{id}
PATCH  /tournaments/{id}
DELETE /tournaments/{id}

GET    /tournaments/{id}/groups
POST   /tournaments/{id}/groups
GET    /tournaments/{id}/groups/{groupId}
PUT    /tournaments/{id}/groups/{groupId}
DELETE /tournaments/{id}/groups/{groupId}
PATCH  /tournaments/{id}/groups/{groupId}/teams

GET    /tournaments/{id}/matches
GET    /tournaments/{id}/matches/{matchId}
POST   /tournaments/{id}/matches
PATCH  /tournaments/{id}/matches/{matchId}/score
DELETE /tournaments/{id}/matches/{matchId}

POST   /tournaments/{id}/start
PATCH  /tournaments/{id}/bracket/matches/{matchId}/score
GET    /tournaments/{id}/champion
```
