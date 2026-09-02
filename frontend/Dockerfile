# ---- Build stage ----
FROM node:22-alpine as build
RUN apk update && apk upgrade && apk add --no-cache
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code (this includes .env file if it exists)
COPY . .

# Verify .env file exists (name check only — never print its contents to the
# build log, which CI systems often retain/expose).
RUN if [ -f .env ]; then echo "✅ .env file found"; grep -oE "^(REACT_APP_AZURE|REACT_APP_API)[A-Z_]*" .env | sort -u; else echo "⚠️ .env file not found - Azure login will not work!"; fi

# Build the React app
# Create React App automatically reads .env file during build
# Environment variables from .env will be embedded in the JavaScript bundle
RUN npm run build

# ---- Production stage ----
FROM nginx:alpine
RUN apk update && apk upgrade && apk add --no-cache
# Copy custom nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy React build files
COPY --from=build /app/build /usr/share/nginx/html

# Expose port 8080 (nginx listens here; the container port is mapped by the host)
EXPOSE 8080

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
