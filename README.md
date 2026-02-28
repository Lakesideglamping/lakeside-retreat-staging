# Lakeside Retreat - Admin Dashboard & Booking System

A full-featured admin dashboard and booking management system for Lakeside Retreat, a glamping accommodation provider in New Zealand. Built with Node.js and Express, featuring Stripe payments, Uplisting channel management, and an AI-powered chatbot.

## Tech Stack

- **Runtime:** Node.js (18+)
- **Framework:** Express 4
- **Database:** PostgreSQL (production) / SQLite (development)
- **Payments:** Stripe
- **Channel Management:** Uplisting API
- **Email:** Nodemailer (SMTP)
- **Auth:** JWT + bcrypt with TOTP 2FA support
- **Security:** Helmet, express-rate-limit, CSRF protection
- **AI Chatbot:** OpenAI API (optional)

## Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- PostgreSQL (production) or SQLite (development)
- Stripe account (for payment processing)
- Uplisting account (for channel management)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/Lakesideglamping/lakeside-retreat-staging.git
cd lakeside-retreat-staging

# Install dependencies
npm install

# Copy the example environment file and configure
cp .env.example .env
# Edit .env with your credentials

# Set up the admin account
npm run setup

# Start the development server
npm run start:dev
```

The server starts on `http://localhost:10000` by default.

## Environment Variables

### Core / Required

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Environment (`development`, `production`, `test`) | `development` |
| `PORT` | Server port | `10000` |
| `JWT_SECRET` | Secret key for signing JWT tokens | Auto-generated in dev (required in production) |
| `ADMIN_USERNAME` | Admin login username | `admin` |
| `ADMIN_PASSWORD_HASH` | Bcrypt hash of the admin password | Set via `npm run setup` |

### Database

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (enables PG mode) | -- |
| `DATABASE_SSL_CA` | Path to SSL CA certificate for PostgreSQL | -- |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Set to `false` to skip SSL verification | -- |
| `SQLITE_PATH` | Path to SQLite database file (dev mode) | `./lakeside.db` |

### Stripe (Payments)

| Variable | Description | Default |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret API key | -- |
| `STRIPE_PUBLIC_KEY` | Stripe publishable key (sent to client) | -- |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | -- |

### Uplisting (Channel Management)

| Variable | Description | Default |
|---|---|---|
| `UPLISTING_API_KEY` | Uplisting API key | -- |
| `UPLISTING_WEBHOOK_SECRET` | Uplisting webhook signing secret | -- |
| `UPLISTING_PINOT_ID` | Uplisting property ID for Dome Pinot | -- |
| `UPLISTING_ROSE_ID` | Uplisting property ID for Dome Rose | -- |
| `UPLISTING_COTTAGE_ID` | Uplisting property ID for Lakeside Cottage | -- |

### Email (SMTP)

| Variable | Description | Default |
|---|---|---|
| `EMAIL_HOST` | SMTP server host | `smtp.gmail.com` |
| `EMAIL_PORT` | SMTP server port | `587` |
| `EMAIL_USER` | SMTP username / sender address | -- |
| `EMAIL_PASS` | SMTP password or app password | -- |
| `ADMIN_EMAIL` | Admin notification recipient | Value of `EMAIL_USER` |
| `CONTACT_EMAIL` | Contact form recipient | Value of `EMAIL_USER` |
| `BACKUP_EMAIL` | Backup notification recipient | Value of `EMAIL_USER` |

### Security & Rate Limiting

| Variable | Description | Default |
|---|---|---|
| `BCRYPT_ROUNDS` | bcrypt hashing rounds | `12` |
| `CSRF_SECRET` | CSRF token secret | Falls back to `JWT_SECRET` |
| `TOTP_ENCRYPTION_KEY` | Encryption key for TOTP secrets | Falls back to `JWT_SECRET` |
| `LOGIN_RATE_LIMIT_ATTEMPTS` | Max login attempts per window | `5` |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | Login rate limit window (minutes) | `15` |
| `GENERAL_RATE_LIMIT_REQUESTS` | Max general requests per window | `100` |
| `GENERAL_RATE_LIMIT_WINDOW_MINUTES` | General rate limit window (minutes) | `15` |

### Optional / Integrations

| Variable | Description | Default |
|---|---|---|
| `PUBLIC_BASE_URL` | Public-facing URL for links in emails | -- |
| `OPENAI_API_KEY` | OpenAI API key for AI chatbot | -- |
| `LOG_LEVEL` | Logging verbosity (`DEBUG`, `INFO`, `WARN`, `ERROR`) | `INFO` |
| `SESSION_SECRET` | Session secret (Render deployment) | -- |

## Available Scripts

| Script | Command | Description |
|---|---|---|
| `npm start` | `node server.js` | Start the server |
| `npm run start:production` | `NODE_ENV=production node server.js` | Start in production mode |
| `npm run start:dev` | `NODE_ENV=development nodemon server.js` | Start with auto-reload (dev) |
| `npm run setup` | `node setup-admin.js` | Set up the admin account |
| `npm run backup` | `node backup-system.js create` | Create a database backup |
| `npm run health` | `curl http://localhost:10000/api/health` | Check server health |
| `npm run lint` | `eslint .` | Run ESLint |
| `npm test` | `jest` | Run the test suite |

## Project Structure

```
lakeside-retreat-staging/
├── server.js                 # Express app entry point
├── database.js               # Database connection (PG/SQLite)
├── db.js                     # Database query helpers
├── config/
│   ├── env.js                # Environment variable validation
│   ├── properties.js         # Accommodation property config
│   └── accommodations.js     # Accommodation details
├── middleware/
│   ├── auth.js               # JWT authentication & CSRF
│   ├── error-handler.js      # Global error handler
│   └── rate-limit.js         # Rate limiting middleware
├── routes/
│   ├── public.js             # Public-facing routes
│   ├── bookings.js           # Booking & payment routes
│   ├── admin-auth.js         # Admin authentication & 2FA
│   ├── admin-bookings.js     # Admin booking management
│   ├── admin-operations.js   # Admin operational routes
│   └── admin-settings.js     # Admin settings routes
├── services/
│   ├── uplisting.js          # Uplisting API service
│   └── backup-verify.js      # Backup verification
├── migrations/
│   ├── runner.js             # Migration runner
│   ├── 001_baseline_schema.js
│   └── 002_add_indexes.js
├── scripts/                  # Utility scripts
├── public/                   # Static assets (CSS, images)
├── images/                   # Property images
├── .github/workflows/ci.yml  # GitHub Actions CI
└── render.yaml               # Render deployment config
```

## Deployment

The project deploys to [Render](https://render.com) using the `render.yaml` configuration file. The production deployment:

- Uses the `main` branch with auto-deploy enabled
- Runs on the Starter plan with Node.js
- Executes `npm install` as the build command
- Starts with `npm run start:production`
- Includes a health check at `/api/health`

Configure all required environment variables in the Render dashboard. Secrets (JWT_SECRET, API keys, etc.) are marked with `sync: false` in render.yaml and must be set manually.

## Security Features

- **Authentication:** JWT-based admin auth with bcrypt password hashing
- **Two-Factor Auth:** Optional TOTP-based 2FA for admin accounts
- **CSRF Protection:** Token-based CSRF mitigation on state-changing requests
- **Rate Limiting:** Configurable limits on login attempts and general API requests
- **HTTP Headers:** Helmet.js for secure HTTP headers
- **Input Validation:** express-validator on all user inputs
- **SQL Injection Prevention:** Parameterized queries throughout
- **Webhook Verification:** HMAC signature validation for Stripe and Uplisting webhooks

## License

All rights reserved.
