# Walking

Random walking-route generator. Enter how many minutes you want to walk; it uses
your current location and OSRM's public foot-routing service to build a random
loop that starts and ends where you are.

**Live site:** https://rexjensen.github.io/Walking/

## Run locally

Just open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000. Geolocation requires HTTPS or `localhost`.

## Deploy

A GitHub Actions workflow (`.github/workflows/pages.yml`) publishes the site to
GitHub Pages on every push. To activate it:

1. In the repo on GitHub, go to **Settings \u2192 Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Re-run the workflow (or push again). The URL appears in the workflow summary.

## Notes

- Routing uses the public OSRM demo server (`router.project-osrm.org`); it has
  rate limits and is best-effort.
- Walking pace defaults to 5 km/h and is adjustable in the UI.
