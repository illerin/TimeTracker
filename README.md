# TimeTracker

Simple time tracking app packaged as a Docker image.

## Automatic Image Builds

Every push to `main` builds and publishes:

```text
illerin/timetracker:latest
```

GitHub Actions publishes the image to Docker Hub using the repository secrets
`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.

## Portainer Setup

Create a stack using `docker-compose.portainer.yml`, or paste this YAML:

```yaml
services:
  timetracker:
    image: illerin/timetracker:latest
    container_name: timetracker
    restart: unless-stopped
    ports:
      - "3025:3000"
    volumes:
      - timetracker-data:/data

volumes:
  timetracker-data:
```

When updating the stack, pull the latest image and redeploy it. Existing app data
remains in the `timetracker-data` volume.

## Docker Compose Setup

Start the app:

```powershell
docker compose -f docker-compose.local.yml pull
docker compose -f docker-compose.local.yml up -d
```

Open the app:

```text
http://localhost:3025
```

## Common Commands

Stop the app:

```powershell
docker compose -f docker-compose.local.yml down
```

Pull the latest image and restart:

```powershell
docker compose -f docker-compose.local.yml pull
docker compose -f docker-compose.local.yml up -d
```

View logs:

```powershell
docker compose -f docker-compose.local.yml logs -f
```
