# Undertone-by-Nico
A personal fashion studio and archive for composing outfits, collecting inspiration, and exploring style through music.

## Local development

Requirements: Docker Desktop, JDK 25, Node 24.

1. Start PostgreSQL 17 from the repository root:

   ```sh
   docker compose up -d
   ```

   Data lives in the `undertone-postgres` Docker volume and survives restarts. `docker compose down` stops the container; add `-v` only if you want to erase all saved compositions.

2. Run the backend from `backend/` (or the IntelliJ run configuration):

   ```sh
   ./mvnw spring-boot:run
   ```

   Flyway applies the schema in `backend/src/main/resources/db/migration` on startup.

3. Run the frontend from `frontend/`: `npm ci`, then `npm run dev`.

### Configuration

Defaults match `docker-compose.yml`; override with environment variables if needed.

| Variable | Default |
| --- | --- |
| `UNDERTONE_DB_URL` | `jdbc:postgresql://localhost:5432/undertone` |
| `UNDERTONE_DB_USER` / `UNDERTONE_DB_PASSWORD` | `undertone` / `undertone` |
| `UNDERTONE_IMAGES_DIR` | `~/Undertone-data/images` |

Image files are stored on disk in `UNDERTONE_IMAGES_DIR`, outside the repository; PostgreSQL holds only their metadata and the compositions.

### Tests

Backend: `./mvnw test` from `backend/`. Integration tests start their own disposable PostgreSQL 17 through Testcontainers, so Docker must be running; they do not touch the development database or image folder.

Frontend: see `frontend/docs/studio-canvas.md`.
