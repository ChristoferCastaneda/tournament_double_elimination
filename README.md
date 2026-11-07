# Tournament Services · Doble eliminación 🏆

API REST e interfaz web para organizar **torneos de doble eliminación**: registrar equipos, armar el bracket, capturar marcadores y llegar al campeón.

## Overview

- **Equipos y grupos**: altas, bajas y cambios, e inscripción de equipos en un torneo.
- **Bracket de doble eliminación**: al iniciar el torneo se sortean los equipos (`RandomTeamSeeder`) y se arman los lados de ganadores y perdedores (`DoubleEliminationBracket`). Quien pierde una vez baja al lado de perdedores; quien pierde dos veces queda fuera.
- **Partidos**: captura de marcadores con `PATCH /bracket/matches/{matchId}/score`; el ganador avanza solo y el campeón sale de `GET /champion`.
- **Interfaz web** sin librerías ni compilación (`wwwroot/`) para recorrer el torneo como usuario, con "Simular ronda" y "Simular todo" para demos.
- **Pruebas** de la API contra PostgreSQL real (`tests/`).

## Tecnologías

.NET 10 · ASP.NET Core Minimal APIs · Entity Framework Core · PostgreSQL 17 · FluentValidation · Docker / Podman · Dev Containers

## Arquitectura

```
src/TournamentServices.Api           Rutas, middleware e interfaz web (wwwroot)
src/TournamentServices.Delegates     Lógica de aplicación (torneo, grupos, partidos, bracket)
src/TournamentServices.Domain        Entidades, bracket de doble eliminación y excepciones
src/TournamentServices.Repositories  EF Core + PostgreSQL
tests/TournamentServices.Api.Tests   Pruebas de la API
```

Más detalles para correr y probar en [`PRUEBAS.md`](PRUEBAS.md).

## Equipo

Repositorio original: [ivanfmm/tournament_double_elimination](https://github.com/ivanfmm/tournament_double_elimination).

- [ivanfmm](https://github.com/ivanfmm)
- Christofer Castañeda
- [Efrain012](https://github.com/Efrain012)
- [ivanGCetys](https://github.com/ivanGCetys)

---

## Cómo levantar el proyecto


1. En fedora crea la carpeta del proyecto y entra en ella
    mkdir tu-proyecto && cd tu-proyecto

2. Copiar el repo 
  git clone

3. Abrir proyecto en Visual Studio Code con el comando: 
  code .
4. Reabrir Visual Studio Code en el Dev Container
   Opcion 1: 
     Ctrl+Shift+P -> 'Dev Containers: Reopen in Container'. Esto construye Containerfile.dev, levanta tournament_db, instala extensiones de C# y corre dotnet restore automáticamente.
   Opcion 2 (más facil):
     Por lo general te aparece una ventana que te dice "Reopen in container" (o algo similar), y le das click. Para ello debes tener la extension de Dev containers.


5. Ya para cuando se quieran ejecutar los endpoints y probarlos, es necesario en la terminal integrada de VS Code (ya dentro del contenedor): dotnet watch run --project src/TournamentServices.Api . Cada vez que guardes un archivo .cs se recompila solo. (ESTO NO ES NECESARIO DE TODAVIA)


## Interfaz web

La API también sirve una interfaz para recorrer un torneo de doble eliminación
como lo haría un usuario. Vive en `src/TournamentServices.Api/wwwroot/` (HTML,
CSS y JavaScript sin librerías ni paso de compilación).

1. Levanta la API como siempre (`dotnet watch run --project src/TournamentServices.Api`
   dentro del dev container).
2. Abre http://localhost:8081 (o http://localhost:5075 si corres `dotnet` fuera del contenedor).
3. Flujo:
   - **Equipos:** crea equipos o pulsa "Generar equipos de ejemplo" (8, 16 o 32).
   - **Torneo:** crea un torneo indicando cuántos equipos participan; los grupos
     se calculan solos. Selecciona equipos, pulsa "Inscribir equipos" y luego "Iniciar torneo".
   - **Bracket:** haz clic en un partido pendiente para capturar el marcador.
     "Simular ronda" y "Simular todo" reportan marcadores al azar para demos.

Los cambios a los archivos de `wwwroot/` se ven al recargar la página, sin reiniciar la API.

En doble eliminación los grupos sólo sirven para inscribir equipos: al iniciar,
todos se sortean juntos. La estructura del bracket que dibuja la interfaz
(`wwwroot/js/bracket-layout.js`) replica la lógica de
`Domain/Brackets/DoubleEliminationBracket.cs`; si se cambia una, hay que cambiar la otra.
