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

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/images` | Upload raw JPEG, PNG or WebP bytes (max 20 MB). The format is detected from the bytes. `201` for a new image, `200` with the existing id when identical bytes were stored before. |
| `GET` | `/api/images/{id}` | The stored image, cacheable indefinitely. |
| `GET` | `/api/compositions` | All compositions with their pieces, most recently updated first. |
| `POST` | `/api/compositions` | Create a composition from a title and pieces. |
| `GET` / `PUT` / `DELETE` | `/api/compositions/{id}` | Read, replace or delete one composition. |

A piece references an uploaded original, an optional cutout and which of the two is shown, plus its position (`x`, `y`), `width` and aspect `ratio` in Studio's world units (the infinite canvas at 100 % zoom; compositions saved earlier sit within 1000 × 700). Piece order is layer order, back to front. When an update or delete leaves an image unused by every composition, its row and file are removed.

Image files are named by the SHA-256 of their content, so duplicates share one file. Studio downscales images to 2000 px on the longest side and converts them to WebP before uploading.

### Tests

Backend: `./mvnw test` from `backend/`. Integration tests start their own disposable PostgreSQL 17 through Testcontainers, so Docker must be running; they do not touch the development database or image folder.

Frontend: see `frontend/docs/studio-canvas.md`.
