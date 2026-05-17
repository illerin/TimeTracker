# TimeTracker

Simple time tracking app with a Docker Compose YAML for quick setup.

## Quick Setup

1. Install Docker Desktop.
2. Create a file named `docker-compose.yml`.
3. Paste this YAML into it:

```yaml
services:
  timetracker:
    image: illerin/timetracker:latest
    container_name: timetracker
    ports:
      - "3025:3000"
    volumes:
      - timetracker-data:/data

volumes:
  timetracker-data:
```

4. Download and start the app:

```powershell
docker compose up -d
```

5. Open the app:

```text
http://localhost:3025
```

## YAML Notes

- Uses image `illerin/timetracker:latest`
- Maps host port `3025` to container port `3000`
- Stores app data in the Docker volume `timetracker-data`

To use a different host port, edit:

```yaml
ports:
  - "3025:3000"
```

For example, change `3025` to `8080`:

```yaml
ports:
  - "8080:3000"
```

## Common Commands

Stop the app:

```powershell
docker compose down
```

Pull the latest image and restart:

```powershell
docker compose pull
docker compose up -d
```

View logs:

```powershell
docker compose logs -f
```
