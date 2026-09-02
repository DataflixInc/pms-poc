# Palicon Frontend

React 18 + TypeScript single-page app (Create React App) for the Palicon background-investigation platform. It authenticates users (manual login or Microsoft 365 / Azure AD via MSAL) and talks to the [Palicon backend API](../backend/Readme.md) for applicant management, document upload/download, and report generation.

---

## 🖥️ Running Locally

### Prerequisites
- Node.js 22+ and npm
- A running instance of the [backend API](../backend/Readme.md) (locally on `http://localhost:8080`, or a deployed Code Engine URL)

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
REACT_APP_API_URL=http://localhost:8080
REACT_APP_API_BASE_URL=http://localhost:8080
REACT_APP_REDIRECT_URI=http://localhost:3000/
```

### Run over HTTPS locally
Microsoft/Azure AD login popups generally require a secure context. Self-signed certs (`localhost.crt` / `localhost.key`) are included for local HTTPS testing. Uncomment in `.env`:
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
docker build -t palicon-frontend .
docker run --rm -p 8080:8080 palicon-frontend
```
This uses the multi-stage `Dockerfile`: it `npm ci && npm run build`s the app in a Node stage, then serves the static `build/` output with `nginx` (config in `nginx.conf`) on port 8080. Open `http://localhost:8080`.

---

## 🔑 Environment Variables

All variables are documented with placeholder values in [`.env.example`](.env.example). Copy it to `.env` and fill in real values — **never commit `.env`** (it currently contains real Azure AD IDs and should be removed from version control / rotated if it has been pushed).

| Variable | Purpose |
|---|---|
| `REACT_APP_API_URL` | Base URL of the backend API the app calls for all data (login, applicants, uploads, downloads, reports) |
| `REACT_APP_API_BASE_URL` | Same backend base URL, referenced by a subset of legacy code paths — keep in sync with `REACT_APP_API_URL` |
| `REACT_APP_AZURE_CLIENT_ID` | Azure AD App Registration (client) ID, used by MSAL for Microsoft 365 SSO login |
| `REACT_APP_AZURE_TENANT_ID` | Azure AD tenant ID for the app registration |
| `REACT_APP_AZURE_AUTHORITY` | MSAL authority URL, normally `https://login.microsoftonline.com/<tenant-id>` |
| `REACT_APP_REDIRECT_URI` | Redirect URI registered in Azure AD for this app (must match the deployed/local URL exactly) |
| `REACT_APP_JWT_SECRET` | Client-side reference secret used when decoding/inspecting JWTs locally (the backend is the source of truth for signing/verification) |
| `GENERATE_SOURCEMAP` | Set `false` to skip generating source maps in production builds (smaller/faster builds, no source leakage) |
| `HTTPS`, `SSL_CRT_FILE`, `SSL_KEY_FILE` | Enable local HTTPS dev server using the included self-signed cert (see above) |

---

## ☁️ Deploying to IBM Cloud (Code Engine)

Like the backend, the frontend is built as a container image and deployed to **IBM Cloud Code Engine**, served by nginx on port 8080. Because CRA embeds env vars into the JS bundle at **build time**, environment values must be correct *before* `docker build` — there's no way to change them at container-runtime.

### One-time setup
```bash
ibmcloud login --sso                     # or: ibmcloud login --apikey <IBM_CLOUD_API_KEY>
ibmcloud target -g <resource-group> -r <region>       # e.g. -r us-south
ibmcloud plugin install container-registry code-engine

ibmcloud cr region-set <region>
ibmcloud cr login
ibmcloud cr namespace-add palicon         # skip if it already exists

ibmcloud ce project create -n palicon-dev
ibmcloud ce project select -n palicon-dev
```

### Build and push the image
Make sure `.env` contains the correct values for the target environment (production backend URL, production Azure redirect URI) before building.
```bash
docker build -t us.icr.io/palicon/palicon-frontend:latest .
docker push us.icr.io/palicon/palicon-frontend:latest
```
Or build inside IBM Cloud without a local Docker daemon:
```bash
ibmcloud ce buildrun submit --name palicon-frontend-build \
  --image us.icr.io/palicon/palicon-frontend:latest \
  --source . --strategy dockerfile
```

### Create or update the application
These match the current **Resources & scaling** configuration of the `palicon-uat-frontend` app in Code Engine:

| Setting | Value |
|---|---|
| CPU / Memory | 4 vCPU / 32 GB |
| Ephemeral storage | 18 GB |
| Min / Max instances | 0 / 10 |
| Target concurrency | 50 |
| Max concurrency | 75 |
| Request timeout | 600s |
| Scale-down delay | 0s |

```bash
# First deploy
ibmcloud ce application create --name palicon-frontend \
  --image us.icr.io/palicon/palicon-frontend:latest \
  --registry-secret <icr-pull-secret> \
  --port 8080 \
  --min-scale 0 --max-scale 10 \
  --cpu 4 --memory 32G --ephemeral-storage 18G \
  --concurrency-target 50 --concurrency 75 \
  --request-timeout 600 --scale-down-delay 0

# Subsequent deploys (after rebuilding the image with new code/env values)
ibmcloud ce application update --name palicon-frontend \
  --image us.icr.io/palicon/palicon-frontend:latest
```

Since this is a static nginx-served app (not the backend's long-running-job case), `min-scale 0` is fine here — it's OK for it to scale to zero when idle and cold-start on the next request.

### Verify
```bash
ibmcloud ce application get --name palicon-frontend -o url
curl <app-url>/
```

**Notes:**
- After deploying, update the Azure AD App Registration's **Redirect URIs** to include the Code Engine app URL, and update `REACT_APP_REDIRECT_URI` in `.env` to match before the next build.
- Update the backend's CORS allow-list (see [backend README](../backend/Readme.md#cors-configuration)) to include the deployed frontend URL.
- `.ceignore` excludes `node_modules/`, `build/`, and other local-only files from the Code Engine build context — dependencies and the production bundle are always produced fresh inside the Docker build stage.

---

## 🔌 Backend API Usage

The frontend is a pure client — it has no API of its own. All data operations call the backend (`REACT_APP_API_URL`), authenticating with a JWT obtained at login and sent as `Authorization: Bearer <token>` on every request except public endpoints (e.g. `/login`). Below are the core endpoints the app depends on; see the [backend README](../backend/Readme.md) for the complete API reference.

Examples below assume the backend is running locally:
```bash
export API=http://localhost:8080
```

### 1. Login
```bash
curl -X POST "$API/login" \
  -H "Content-Type: application/json" \
  -d '{
        "username": "katie.machado@palicongroup.com",
        "password": "S2F0aHJ5bl9NYWNoYWRvcGFsaWNvbg=="
      }'
```
Response includes a JWT `token` used for subsequent requests:
```bash
export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 2. Validate / refresh session
```bash
curl -X POST "$API/validate-token" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$TOKEN\"}"
```

### 3. Get applicant status (paginated list)
```bash
curl -G "$API/applicant-status" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "page=1" \
  --data-urlencode "limit=100"
```

### 4. Upload an Excel batch of applicants
```bash
curl -X POST "$API/upload-excel" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./applicants.xlsx"
```

### 5. Upload individual applicant documents
```bash
curl -X POST "$API/upload-individual-files" \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@./document1.pdf" \
  -F "files=@./document2.pdf" \
  -F "applicant_id=CHP-SO-160925-01"
```

### 6. Download a generated report/document
```bash
curl -X GET "$API/download?applicant_id=CHP-SO-160925-01&document_type=background_report" \
  -H "Authorization: Bearer $TOKEN" \
  -o report.pdf
```

### 7. Logout
```bash
curl -X POST "$API/logout" \
  -H "Authorization: Bearer $TOKEN"
```

For the full set of endpoints (applicant management, references, investigator dashboard, background report templates, etc.) and their request/response shapes, see the [backend API documentation](../backend/Readme.md).
