# Performance Management System — Frontend

React 18 + TypeScript single-page app (Create React App) for Dataflix's Performance Management System (PMS). It authenticates users (manual login or Microsoft 365 / Azure AD via MSAL) and talks to the PMS backend API for the Self Review, Manager Review, HR Review, and Overall Review workflows.

---

## 🖥️ Running Locally

### Prerequisites
- Node.js 22+ and npm
- A running instance of the backend API (see [`../backend`](../backend)) — locally (FastAPI/uvicorn) or a deployed instance

### Setup
```bash
cd frontend
npm install

# Copy the env template and fill in real values
cp .env.example .env
```
Edit `.env` with your backend URL and Azure AD app registration details — see [Environment Variables](#-environment-variables) below.

### Run the dev server
```bash
npm start
```
This starts the Create React App dev server on **http://localhost:3000** with hot reload.

To point the app at a local backend instead of a deployed one, edit `.env`:
```bash
REACT_APP_API_URL=http://localhost:8000
REACT_APP_API_BASE_URL=http://localhost:8000
REACT_APP_REDIRECT_URI=http://localhost:3000/
```
(Adjust the port to whatever you actually run the backend on — 8000 is uvicorn's own default.)

### Run over HTTPS locally
Microsoft/Azure AD login popups generally require a secure context. This repo doesn't ship a local cert — generate your own self-signed one (e.g. with [`mkcert`](https://github.com/FiloSottile/mkcert): `mkcert localhost`), then uncomment in `.env`:
```bash
HTTPS=true
SSL_CRT_FILE=./localhost.crt
SSL_KEY_FILE=./localhost.key
```
then run `npm start` again and open `https://localhost:3000` (accept the browser's self-signed cert warning).

### Production build
```bash
npm run build
```
Outputs static assets to `build/`. Create React App bakes every `REACT_APP_*` variable from `.env` into the JS bundle at build time — there is no runtime env config, so you must rebuild whenever an env value changes (e.g. pointing at a different backend).

### Run with Docker (matches production)
```bash
docker build -t pms-frontend .
docker run --rm -p 8080:8080 pms-frontend
```
This uses the multi-stage `Dockerfile`: it `npm ci && npm run build`s the app in a Node stage, then serves the static `build/` output with `nginx` (config in `nginx.conf`) on port 8080. Open `http://localhost:8080`.

---

## 🔑 Environment Variables

All variables are documented with placeholder values in [`.env.example`](.env.example). Copy it to `.env` and fill in real values — **never commit `.env`**.

| Variable | Purpose |
|---|---|
| `REACT_APP_API_URL` | Base URL of the backend API the app calls for all data (login, reviews, team/roster views). Falls back to the deployed Azure App Service URL if unset (see `apiService.ts`) |
| `REACT_APP_API_BASE_URL` | Declared in `.env.example` but not currently read anywhere in the source (`REACT_APP_API_URL` is the one actually used) — set it for consistency, but it has no effect today |
| `REACT_APP_AZURE_CLIENT_ID` | Azure AD App Registration (client) ID, used by MSAL for Microsoft 365 SSO login |
| `REACT_APP_AZURE_TENANT_ID` | Azure AD tenant ID for the app registration — MSAL builds the authority URL from this directly (`https://login.microsoftonline.com/<tenant-id>`) |
| `REACT_APP_AZURE_AUTHORITY` | Declared in `.env.example` but not currently read anywhere in the source — the authority URL is always derived from `REACT_APP_AZURE_TENANT_ID` instead (see above), so setting this has no effect today |
| `REACT_APP_REDIRECT_URI` | Redirect URI registered in Azure AD for this app (must match the deployed/local URL exactly) |
| `GENERATE_SOURCEMAP` | Set `false` to skip generating source maps in production builds (smaller/faster builds, no source leakage) |
| `HTTPS`, `SSL_CRT_FILE`, `SSL_KEY_FILE` | Enable local HTTPS dev server using your own self-signed cert (see above) |

---

## ☁️ Deployment

The frontend runs as a static build served by nginx inside the `Dockerfile` above. The currently deployed instance is hosted on **Azure App Service** — the exact pipeline/CLI steps for that (resource names, CI config) live wherever your team's deployment tooling is set up, not in this repo, so they aren't repeated here to avoid documenting something that could drift out of sync again. If you're setting up a new environment, the two things that must be correct *before* building the image are:

- The `REACT_APP_*` values in `.env` (baked in at build time — see above)
- The Azure AD App Registration's **Redirect URIs**, which must include whatever URL this build will be served from

---

## 🔌 Backend API Usage

The frontend is a pure client — it has no API of its own. All data operations call the backend (`REACT_APP_API_URL`), authenticating with a JWT obtained at login and sent as `Authorization: Bearer <token>` on every request except `/login` itself. Below are the core endpoints the app depends on (see `backend/main.py` for the full implementation).

Examples below assume the backend is running locally:
```bash
export API=http://localhost:8000
```

### 1. Login
```bash
curl -X POST "$API/login" \
  -H "Content-Type: application/json" \
  -d '{
        "username": "jane.doe@example.com",
        "password": "<base64-encoded-password>"
      }'
```
Response includes a JWT `token` used for subsequent requests:
```bash
export TOKEN="<jwt-token-from-response>"
```

### 2. Get my status (Dashboard)
Everything the logged-in user's own Dashboard needs — Self/Manager/HR/Overall Review status for the current period, plus the Self Review form and any submitted answers.
```bash
curl "$API/api/employees/results" \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Get a form template + submission together
`template_id` is `1001` (Self Review), `1002` (Manager Review), `1003` (HR Review), or `1004` (Overall Review). Pass `employee_id` when acting on someone else's form (a manager on a report, or HR/CDO on any employee).
```bash
curl "$API/api/forms/1002/full?employee_id=<employee-id>" \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Save a draft (autosave)
```bash
curl -X PUT "$API/api/forms/1001/draft" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"answers": {"1": "some answer"}}'
```

### 5. Submit a form
```bash
curl -X POST "$API/api/forms/1002/submit?employee_id=<employee-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"answers": {"1": "some answer"}}'
```

### 6. Approve or reject a Manager Review
HR/CDO only, and only for `template_id` `1002`. `reason` is required when rejecting.
```bash
curl -X POST "$API/api/forms/1002/approval?employee_id=<employee-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "rejected", "reason": "Needs more detail on Q4 deliverables"}'
```

### 7. Get my team (manager roster)
```bash
curl "$API/api/manager/team" \
  -H "Authorization: Bearer $TOKEN"
```

### 8. Get the org-wide roster (HR/CDO)
```bash
curl "$API/api/hr/employees" \
  -H "Authorization: Bearer $TOKEN"
```

For the complete set of endpoints and their request/response shapes, read `backend/main.py` directly — there is no separate backend README in this repo.
