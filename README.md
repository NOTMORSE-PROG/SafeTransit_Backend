# SafeTransit Backend API

Backend API for SafeTransit mobile app, deployed on Vercel as serverless functions.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables in Vercel:
   - `DATABASE_URL` - Neon PostgreSQL connection string
   - `JWT_SECRET` - Secret key for JWT tokens
   - `JWT_EXPIRES_IN` - Token expiration (e.g., "7d", "100y")

## Local Development

```bash
npm run dev
```

## Deploy to Vercel

```bash
npm run deploy
```

Or connect this repository to Vercel for automatic deployments.

## API Endpoints

### Authentication
- `POST /api/auth/google` - Google Sign-In/Sign-Up
- `POST /api/auth/login` - Email/Password Login
- `POST /api/auth/signup` - Email/Password Sign-Up
- `GET /api/auth/verify` - Verify JWT Token
- `POST /api/auth/link-google` - Link Google account to existing user

## Project Structure

```
backend/
├── api/
│   └── auth/
│       ├── google.ts
│       ├── login.ts
│       ├── signup.ts
│       ├── verify.ts
│       └── link-google.ts
├── services/
│   ├── auth/
│   │   ├── jwt.ts
│   │   ├── password.ts
│   │   └── validation.ts
│   └── repositories/
│       └── userRepository.ts
├── package.json
└── vercel.json
```
