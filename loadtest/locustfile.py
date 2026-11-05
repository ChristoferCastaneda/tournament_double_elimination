"""
Load test de Locust para TournamentServices.

Cada usuario virtual ejecuta un ciclo completo:

  1. Consulta /health y crea equipos (GET, POST, GET por id, PUT).
  2. Crea un torneo DOUBLE_ELIMINATION, lo actualiza con PUT y PATCH y
     crea/renombra/borra grupos, incluyendo la asignación de equipos.
  3. Inicia el torneo, reporta resultados del bracket uno por uno y termina
     cuando la API devuelve el campeón.
  4. Crea un torneo ROUND_ROBIN aparte para ejercer el CRUD de /matches
     (POST, GET, PATCH score y DELETE). En doble eliminación esos endpoints
     responden 422 a propósito, por eso se prueban en un torneo aparte.
  5. Borra los torneos y equipos creados (se puede desactivar con CLEANUP=0).

Uso rápido:

    pip install -r loadtest/requirements.txt
    locust -f loadtest/locustfile.py --host http://localhost:8081

Prueba headless con reporte HTML:

    locust -f loadtest/locustfile.py --host http://localhost:8081 \
        --headless --users 5 --spawn-rate 1 --run-time 3m \
        --html loadtest/report.html

Variables de entorno:

    API_HOST                  Host por defecto (--host tiene prioridad).
    TEAMS_PER_TOURNAMENT      Equipos por torneo (default 8, mínimo 2).
    GROUPS_PER_TOURNAMENT     Grupos reales por torneo (default 2).
    WAIT_MIN / WAIT_MAX       Espera entre ciclos por usuario (default 0.1/0.5 s).
    CLEANUP                   1 para borrar lo creado, 0 para conservarlo.
"""

from __future__ import annotations

import math
import os
import random
import uuid

from locust import HttpUser, SequentialTaskSet, between, task
from locust.exception import InterruptTaskSet

DEFAULT_HOST = os.getenv("API_HOST", "http://localhost:8081")
TEAMS = max(2, int(os.getenv("TEAMS_PER_TOURNAMENT", "8")))
GROUPS = max(1, int(os.getenv("GROUPS_PER_TOURNAMENT", "2")))
WAIT_LOW, WAIT_HIGH = sorted(
    (float(os.getenv("WAIT_MIN", "0.1")), float(os.getenv("WAIT_MAX", "0.5")))
)
CLEANUP = os.getenv("CLEANUP", "1").strip().lower() not in {"0", "false", "no", "off"}

# Resultados sin empate: en eliminación directa un empate devuelve 422.
SCORES = [(1, 0), (0, 1), (2, 0), (0, 2), (3, 1), (1, 3), (5, 2), (2, 5)]


class TournamentFlow:
    """Un ciclo completo de negocio ejecutado por un usuario virtual."""

    def __init__(self, user: HttpUser):
        self.user = user
        self.client = user.client
        self.suffix = uuid.uuid4().hex[:12]
        self.groups = max(1, min(GROUPS, TEAMS))
        self.max_per_group = math.ceil(TEAMS / self.groups)
        self.de_team_ids: list[str] = []
        self.rr_team_ids: list[str] = []
        self.de_tournament_id: str | None = None
        self.rr_tournament_id: str | None = None

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    def call(
        self,
        method: str,
        path: str,
        *,
        name: str,
        expected: tuple[int, ...] | int = (200,),
        parse_json: bool = True,
        validate=None,
        **kwargs,
    ):
        if isinstance(expected, int):
            expected = (expected,)

        with self.client.request(
            method, path, name=name, catch_response=True, **kwargs
        ) as response:
            if response.status_code not in expected:
                detail = (response.text or "")[:300].replace("\n", " ")
                response.failure(
                    f"HTTP {response.status_code} (esperaba {expected}): {detail}"
                )
                raise InterruptTaskSet(reschedule=True)

            data = None
            if response.content and parse_json:
                try:
                    data = response.json()
                except ValueError:
                    response.failure("La respuesta no es JSON válido")
                    raise InterruptTaskSet(reschedule=True) from None

            if validate is not None:
                try:
                    valid = validate(data)
                except Exception:
                    valid = False
                if not valid:
                    response.failure(f"Respuesta inesperada: {str(data)[:300]}")
                    raise InterruptTaskSet(reschedule=True)

            response.success()
            return data

    def safe_call(
        self,
        method: str,
        path: str,
        *,
        name: str,
        expected: tuple[int, ...] = (200, 204),
    ) -> None:
        """Llamada de limpieza: registra el resultado pero nunca interrumpe."""
        try:
            with self.client.request(
                method, path, name=name, catch_response=True
            ) as response:
                if response.status_code in expected:
                    response.success()
                else:
                    response.failure(f"HTTP {response.status_code} durante limpieza")
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Ciclo completo
    # ------------------------------------------------------------------
    def run(self) -> None:
        try:
            self.health()
            self.double_elimination_teams()
            self.double_elimination_tournament()
            self.double_elimination_groups()
            self.double_elimination_bracket()
            self.match_crud()
        finally:
            self.cleanup()

    # ------------------------------------------------------------------
    # 1. Health + ABC de equipos
    # ------------------------------------------------------------------
    def health(self) -> None:
        self.call("GET", "/health", name="GET /health", parse_json=False)

    def double_elimination_teams(self) -> None:
        self.call("GET", "/teams", name="GET /teams")

        for index in range(TEAMS):
            team_name = f"LT-{self.suffix}-de-{index:02d}"
            created = self.call(
                "POST",
                "/teams",
                expected=(201,),
                name="POST /teams",
                json={"name": team_name},
            )
            team_id = created["id"]
            self.de_team_ids.append(team_id)

            self.call("GET", f"/teams/{team_id}", name="GET /teams/{id}")

            self.call(
                "PUT",
                f"/teams/{team_id}",
                name="PUT /teams/{id}",
                json={"name": f"{team_name}-renombrado"},
            )

        # Casos de error esperados del ABC.
        self.call(
            "POST",
            "/teams",
            expected=(400,),
            name="POST /teams (nombre duplicado)",
            json={"name": f"LT-{self.suffix}-de-00-renombrado"},
        )
        self.call(
            "GET",
            "/teams/id_invalido",
            expected=(400,),
            name="GET /teams/{id} (id inválido)",
        )

    # ------------------------------------------------------------------
    # 2. ABC del torneo
    # ------------------------------------------------------------------
    def double_elimination_tournament(self) -> None:
        self.call("GET", "/tournaments", name="GET /tournaments")

        base_name = f"LT-{self.suffix}-cup"
        format_payload = {
            "maxTeamsPerGroup": self.max_per_group,
            # Un grupo extra temporal para probar DELETE /groups.
            "numberOfGroups": self.groups + 1,
            "type": "DOUBLE_ELIMINATION",
        }

        created = self.call(
            "POST",
            "/tournaments",
            expected=(201,),
            name="POST /tournaments",
            json={"name": base_name, "format": format_payload},
        )
        self.de_tournament_id = created["id"]
        tid = self.de_tournament_id

        self.call("GET", f"/tournaments/{tid}", name="GET /tournaments/{id}")

        self.call(
            "PUT",
            f"/tournaments/{tid}",
            name="PUT /tournaments/{id}",
            json={"name": f"{base_name}-edicion", "format": format_payload},
        )
        self.call(
            "PATCH",
            f"/tournaments/{tid}",
            name="PATCH /tournaments/{id}",
            json={"name": f"{base_name}-final"},
        )
        self.call(
            "PATCH",
            f"/tournaments/{tid}",
            name="PATCH /tournaments/{id} (formato)",
            json=format_payload,
        )

        self.call(
            "POST",
            "/tournaments",
            expected=(400,),
            name="POST /tournaments (nombre duplicado)",
            json={"name": f"{base_name}-final", "format": format_payload},
        )
        self.call(
            "GET",
            "/tournaments/id_invalido",
            expected=(400,),
            name="GET /tournaments/{id} (id inválido)",
        )

    # ------------------------------------------------------------------
    # 3. ABC de grupos + asignación de equipos
    # ------------------------------------------------------------------
    def double_elimination_groups(self) -> None:
        tid = self.de_tournament_id
        assert tid is not None
        groups_url = f"/tournaments/{tid}/groups"

        self.call("GET", groups_url, name="GET /tournaments/{id}/groups")

        # Grupo temporal: se crea, se renombra, se consulta y se borra.
        temp = self.call(
            "POST",
            groups_url,
            expected=(201,),
            name="POST /tournaments/{id}/groups",
            json={"name": "Temporal"},
        )
        temp_id = temp["id"]
        self.call(
            "GET",
            f"{groups_url}/{temp_id}",
            name="GET /tournaments/{id}/groups/{groupId}",
        )
        self.call(
            "PUT",
            f"{groups_url}/{temp_id}",
            name="PUT /tournaments/{id}/groups/{groupId}",
            json={"name": "Temporal renombrado"},
        )
        self.call(
            "POST",
            groups_url,
            expected=(422,),
            name="POST /tournaments/{id}/groups (nombre duplicado)",
            json={"name": "temporal renombrado"},
        )

        # Grupos reales que alimentan el bracket.
        group_ids: list[str] = []
        for index in range(self.groups):
            group = self.call(
                "POST",
                groups_url,
                expected=(201,),
                name="POST /tournaments/{id}/groups",
                json={"name": f"Grupo {index + 1}"},
            )
            group_ids.append(group["id"])

        self.call(
            "PUT",
            f"{groups_url}/{group_ids[0]}",
            name="PUT /tournaments/{id}/groups/{groupId}",
            json={"name": f"Grupo {self.suffix}-A"},
        )

        for index, group_id in enumerate(group_ids):
            start = index * self.max_per_group
            chunk = self.de_team_ids[start : start + self.max_per_group]
            self.call(
                "PATCH",
                f"{groups_url}/{group_id}/teams",
                expected=(204,),
                name="PATCH /tournaments/{id}/groups/{groupId}/teams",
                json=chunk,
            )

        self.call(
            "DELETE",
            f"{groups_url}/{temp_id}",
            expected=(204,),
            name="DELETE /tournaments/{id}/groups/{groupId}",
        )
        self.call(
            "GET",
            f"{groups_url}/{temp_id}",
            expected=(404,),
            name="GET /tournaments/{id}/groups/{groupId} (borrado)",
        )

        self.call("GET", groups_url, name="GET /tournaments/{id}/groups")
        for group_id in group_ids:
            self.call(
                "GET",
                f"{groups_url}/{group_id}",
                name="GET /tournaments/{id}/groups/{groupId}",
            )

    # ------------------------------------------------------------------
    # 4. Inicio a fin del torneo de doble eliminación
    # ------------------------------------------------------------------
    def double_elimination_bracket(self) -> None:
        tid = self.de_tournament_id
        assert tid is not None

        self.call(
            "GET",
            f"/tournaments/{tid}/champion",
            expected=(422,),
            name="GET /tournaments/{id}/champion (sin campeón)",
        )

        self.call(
            "POST",
            f"/tournaments/{tid}/start",
            name="POST /tournaments/{id}/start",
            validate=lambda data: data.get("status") == "IN_PROGRESS",
        )
        self.call(
            "POST",
            f"/tournaments/{tid}/start",
            expected=(422,),
            name="POST /tournaments/{id}/start (ya iniciado)",
        )

        matches = self.call(
            "GET",
            f"/tournaments/{tid}/matches",
            name="GET /tournaments/{id}/matches",
        )

        played = 0
        max_matches = (2 * TEAMS) + 5
        while True:
            pending = [match for match in matches if not match["isCompleted"]]
            if not pending:
                break

            if played >= max_matches:
                raise RuntimeError(
                    f"El bracket de {tid} no terminó después de {max_matches} partidos"
                )

            match = pending[0]
            match_id = match["id"]

            self.call(
                "GET",
                f"/tournaments/{tid}/matches/{match_id}",
                name="GET /tournaments/{id}/matches/{matchId}",
            )

            home_score, visitor_score = random.choice(SCORES)
            self.report_bracket_score(tid, match_id, home_score, visitor_score)
            played += 1

            matches = self.call(
                "GET",
                f"/tournaments/{tid}/matches",
                name="GET /tournaments/{id}/matches",
            )

        self.call(
            "GET",
            f"/tournaments/{tid}/champion",
            name="GET /tournaments/{id}/champion",
            validate=lambda data: data.get("id") in self.de_team_ids,
        )
        self.call(
            "GET",
            f"/tournaments/{tid}",
            name="GET /tournaments/{id} (finalizado)",
            validate=lambda data: data.get("status") == "FINISHED",
        )

        # Una vez iniciado, el formato ya no se puede cambiar.
        self.call(
            "PATCH",
            f"/tournaments/{tid}",
            expected=(422,),
            name="PATCH /tournaments/{id} (iniciado)",
            json={"numberOfGroups": self.groups},
        )

    def report_bracket_score(
        self,
        tournament_id: str,
        match_id: str,
        home_score: int,
        visitor_score: int,
    ) -> None:
        url = (
            f"/tournaments/{tournament_id}/bracket/matches/{match_id}/score"
        )
        name = "PATCH /tournaments/{id}/bracket/matches/{matchId}/score"
        body = {"homeTeamScore": home_score, "visitorTeamScore": visitor_score}

        for attempt in range(3):
            with self.client.patch(
                url, json=body, name=name, catch_response=True
            ) as response:
                if response.status_code == 200:
                    response.success()
                    return

                if response.status_code == 409 and attempt < 2:
                    # Otra operación del bracket ganó la carrera; reintentar.
                    response.success()
                    continue

                detail = (response.text or "")[:300].replace("\n", " ")
                response.failure(f"HTTP {response.status_code}: {detail}")
                raise InterruptTaskSet(reschedule=True)

        raise InterruptTaskSet(reschedule=True)

    # ------------------------------------------------------------------
    # 5. CRUD de /matches con un torneo ROUND_ROBIN
    # ------------------------------------------------------------------
    def match_crud(self) -> None:
        suffix = f"{self.suffix}-rr"

        team_ids: list[str] = []
        for index in range(2):
            team = self.call(
                "POST",
                "/teams",
                expected=(201,),
                name="POST /teams",
                json={"name": f"LT-{suffix}-team-{index}"},
            )
            team_ids.append(team["id"])
        self.rr_team_ids = team_ids

        tournament = self.call(
            "POST",
            "/tournaments",
            expected=(201,),
            name="POST /tournaments",
            json={
                "name": f"LT-{suffix}-league",
                "format": {
                    "maxTeamsPerGroup": 2,
                    "numberOfGroups": 1,
                    "type": "ROUND_ROBIN",
                },
            },
        )
        tid = tournament["id"]
        self.rr_tournament_id = tid

        groups_url = f"/tournaments/{tid}/groups"
        group = self.call(
            "POST",
            groups_url,
            expected=(201,),
            name="POST /tournaments/{id}/groups",
            json={"name": "Liga"},
        )
        group_id = group["id"]

        self.call(
            "PATCH",
            f"{groups_url}/{group_id}/teams",
            expected=(204,),
            name="PATCH /tournaments/{id}/groups/{groupId}/teams",
            json=team_ids,
        )

        match = self.call(
            "POST",
            f"/tournaments/{tid}/matches",
            expected=(201,),
            name="POST /tournaments/{id}/matches",
            json={
                "homeTeamId": team_ids[0],
                "visitorTeamId": team_ids[1],
                "groupId": group_id,
            },
        )
        match_id = match["id"]

        self.call(
            "GET",
            f"/tournaments/{tid}/matches",
            name="GET /tournaments/{id}/matches",
        )
        self.call(
            "GET",
            f"/tournaments/{tid}/matches/{match_id}",
            name="GET /tournaments/{id}/matches/{matchId}",
        )

        home_score, visitor_score = random.choice(SCORES)
        self.call(
            "PATCH",
            f"/tournaments/{tid}/matches/{match_id}/score",
            name="PATCH /tournaments/{id}/matches/{matchId}/score",
            json={"homeTeamScore": home_score, "visitorTeamScore": visitor_score},
        )
        self.call(
            "GET",
            f"/tournaments/{tid}/matches/{match_id}",
            name="GET /tournaments/{id}/matches/{matchId} (con resultado)",
            validate=lambda data: data.get("isCompleted") is True,
        )
        self.call(
            "DELETE",
            f"/tournaments/{tid}/matches/{match_id}",
            expected=(204,),
            name="DELETE /tournaments/{id}/matches/{matchId}",
        )
        self.call(
            "GET",
            f"/tournaments/{tid}/matches/{match_id}",
            expected=(404,),
            name="GET /tournaments/{id}/matches/{matchId} (borrado)",
        )

    # ------------------------------------------------------------------
    # 6. Limpieza
    # ------------------------------------------------------------------
    def cleanup(self) -> None:
        if not CLEANUP:
            return

        if self.de_tournament_id:
            self.safe_call(
                "DELETE",
                f"/tournaments/{self.de_tournament_id}",
                name="DELETE /tournaments/{id}",
            )
            self.de_tournament_id = None

        if self.rr_tournament_id:
            self.safe_call(
                "DELETE",
                f"/tournaments/{self.rr_tournament_id}",
                name="DELETE /tournaments/{id}",
            )
            self.rr_tournament_id = None

        for team_id in self.de_team_ids:
            self.safe_call("DELETE", f"/teams/{team_id}", name="DELETE /teams/{id}")
        self.de_team_ids.clear()

        for team_id in self.rr_team_ids:
            self.safe_call("DELETE", f"/teams/{team_id}", name="DELETE /teams/{id}")
        self.rr_team_ids.clear()


class TournamentLifecycle(SequentialTaskSet):
    @task
    def full_lifecycle(self) -> None:
        TournamentFlow(self.user).run()


class TournamentLoadTest(HttpUser):
    host = DEFAULT_HOST
    wait_time = between(WAIT_LOW, WAIT_HIGH)
    tasks = [TournamentLifecycle]
