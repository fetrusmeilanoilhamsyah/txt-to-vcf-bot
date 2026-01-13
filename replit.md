# TXT to VCF Converter

## Overview

A web-based utility application that converts plain text files containing phone numbers into VCF (vCard) contact files. The application provides both a web interface and a Telegram bot interface for file conversion. It supports automatic file splitting for large contact lists, custom contact naming, and VIP membership features for the Telegram bot.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui component library (New York style)
- **Animations**: Framer Motion for smooth transitions and drag-and-drop
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite with path aliases (@/ for client/src, @shared/ for shared)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **Database ORM**: Drizzle ORM with PostgreSQL
- **File Handling**: Multer for multipart form data (file uploads)
- **Telegram Integration**: node-telegram-bot-api for bot functionality
- **ZIP Creation**: adm-zip for bundling multiple VCF files

### API Design
- Single conversion endpoint: `POST /api/convert`
- Accepts FormData with file, contactName, fileName, and splitLimit
- Returns either a single VCF file or a ZIP archive containing multiple VCF files

### Shared Code Pattern
- The `shared/` directory contains code used by both frontend and backend
- Schema definitions (Drizzle tables + Zod validation) in `shared/schema.ts`
- API route definitions in `shared/routes.ts`

### Database Schema
- **users**: Basic user authentication (id, username, password)
- **conversions**: Tracks conversion history from Telegram bot
- **membershipPackages**: VIP membership tiers with pricing
- **userMemberships**: Tracks active user memberships
- **paymentRecords**: Payment history for memberships

### Build Process
- Custom build script using esbuild for server and Vite for client
- Server dependencies are bundled to reduce cold start times
- Output to `dist/` directory with `dist/public/` for static assets

## External Dependencies

### Database
- **PostgreSQL**: Primary database, connection via DATABASE_URL environment variable
- **Drizzle Kit**: Database migrations stored in `migrations/` directory

### Third-Party Services
- **Telegram Bot API**: Requires TELEGRAM_BOT_TOKEN environment variable
- Bot provides TXT to VCF conversion and VIP membership management
- Admin features controlled by ADMIN_TELEGRAM_ID

### Key npm Packages
- **UI Components**: Full shadcn/ui component suite with Radix UI primitives
- **Validation**: Zod for schema validation, drizzle-zod for database schema integration
- **File Processing**: adm-zip for ZIP file creation, multer for uploads
- **Styling**: Tailwind CSS, class-variance-authority, clsx, tailwind-merge

## Deployment to Portfolio

To showcase this project in your own portfolio website, you have several options:

### 1. Embed the App
You can embed your Replit app directly using an iframe. Append `?embed=true` to your public URL:
```html
<iframe src="https://your-app-name.your-username.replit.app?embed=true" width="100%" height="600px"></iframe>
```

### 2. Custom Domain
If you have your own domain (e.g., `tools.yourname.com`):
1. Go to the **Deployments** tab in Replit.
2. Under **Settings**, find **Link a domain**.
3. Follow the instructions to add CNAME/A records in your domain provider (Cloudflare, Niagahoster, etc.).

### 3. Screenshots & Bot Link
For the best portfolio presentation:
- Take high-quality screenshots of the Web Interface and the Telegram Bot in action.
- Provide a direct link to your Telegram bot (e.g., `t.me/YourBotName`).
- Explain the features: "Auto-increment numbering", "VIP Membership System", and "Fast VCF Conversion".
