# SolarLead AI

Identify and prioritize commercial properties for rooftop solar and battery storage projects.

## What It Does

SolarLead AI helps sales teams find high-quality solar leads by combining:
- **Business Discovery** - Find businesses via Google Places or mock data
- **Solar Suitability** - Assess rooftop solar potential via Google Solar API
- **Company Enrichment** - Analyze websites for energy-relevant signals
- **Multi-Factor Scoring** - Score leads 0-100 across business fit, electricity usage, solar potential, and outreach readiness
- **Sales Workflow** - Manage leads through a pipeline (new → reviewed → contacted → qualified → rejected)

## Tech Stack

- **Next.js 15** (App Router, Server Actions)
- **TypeScript** (strict mode)
- **Tailwind CSS** + **shadcn/ui**
- **Supabase** (Auth + PostgreSQL)
- **Zod** (validation)

## Getting Started

### 1. Prerequisites
- Node.js 18+
- A Supabase project (free tier works)

### 2. Install

```bash
npm install
```

### 3. Configure Environment

Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.local.example .env.local
```

Required:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anon/public key

Optional (app works without these using mock data):
- `GOOGLE_PLACES_API_KEY` - For live business search
- `GOOGLE_SOLAR_API_KEY` - For live solar assessments

### 4. Set Up Database

Run the schema in your Supabase SQL editor:
1. Go to Supabase Dashboard → SQL Editor
2. Run `supabase/schema.sql`
3. Optionally run `supabase/seed.sql` for demo data

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Mock Mode

The app runs fully without external APIs. Set `NEXT_PUBLIC_PROVIDER_MODE=mock` (default) or toggle in Settings. Mock providers return realistic German business data, solar assessments, and enrichment results.

## Project Structure

```
src/
├── app/
│   ├── (auth)/              # Login + Register pages
│   ├── dashboard/           # Protected dashboard pages
│   │   ├── page.tsx         # Dashboard home (KPIs, recent leads)
│   │   ├── search/          # Lead discovery workflow
│   │   ├── leads/           # Lead list + detail pages
│   │   ├── import/          # CSV import/export
│   │   └── settings/        # API keys, scoring weights
│   └── api/                 # API routes (search, solar, enrich, recalculate)
├── components/
│   ├── ui/                  # shadcn/ui components
│   ├── dashboard/           # Sidebar, logout button
│   └── leads/               # Lead table, filters, editors
├── lib/
│   ├── supabase/            # Supabase client (browser + server)
│   ├── providers/
│   │   ├── search/          # Google Places + mock search
│   │   ├── solar/           # Google Solar API + mock solar
│   │   └── enrichment/      # Website analysis + mock enrichment
│   ├── scoring/             # Multi-factor scoring engine
│   └── actions/             # Server actions (leads, settings)
└── types/                   # TypeScript types
supabase/
├── schema.sql               # Full database schema with RLS
└── seed.sql                 # Demo data (15 German businesses)
```

## Features

### Search & Discovery
Search for businesses by country, city, radius, and category. Supports 12 target categories: logistics, warehouse, cold storage, supermarket, food production, manufacturing, metalworking, car dealerships, hotels, furniture stores, hardware stores, shopping centers.

### Scoring System (0-100)
| Factor | Default Weight | What It Measures |
|--------|---------------|------------------|
| Business Fit | 30% | Category suitability for solar (roof type, size) |
| Electricity | 25% | Estimated electricity consumption by industry |
| Solar Potential | 25% | Roof area, panel capacity, energy output |
| Outreach Readiness | 20% | Contact info availability, website signals |

Weights are configurable in Settings.

### Lead Pipeline
Leads flow through statuses: **New** → **Reviewed** → **Contacted** → **Qualified** / **Rejected**

### Lead Detail Page
- Company info with all contact details
- Solar assessment breakdown (quality, panels, area, energy, carbon offset)
- Enrichment data (website keywords, signals)
- Score breakdown with explanations
- Auto-generated outreach preparation notes
- Editable notes, status, and LinkedIn URL

### Import/Export
- CSV import with column mapping and deduplication
- CSV export with filters

## API Keys

| API | Purpose | Where to Get |
|-----|---------|-------------|
| Google Places API | Live business search | [Google Cloud Console](https://console.cloud.google.com/) → Places API (New) |
| Google Solar API | Live rooftop solar data | [Google Cloud Console](https://console.cloud.google.com/) → Solar API |

Both are optional. Configure in Settings → API Configuration.

## Database

Uses Supabase PostgreSQL with Row Level Security. Tables:
- `leads` - Core lead data with scores and status
- `solar_assessments` - Solar API results per lead
- `lead_enrichment` - Website analysis results per lead
- `search_runs` - Search history
- `user_settings` - Per-user API keys and scoring weights

## TODOs

- [ ] **LinkedIn Enrichment** - Company/decision-maker lookup (manual field exists)
- [ ] **CRM Integration** - Export to HubSpot, Salesforce, Pipedrive
- [ ] **AI Outreach** - LLM-generated personalized email drafts
- [ ] **Satellite Analysis** - Roof imagery analysis for better solar estimates
- [ ] **Batch Processing** - Background job queue for large searches
- [ ] **Team Collaboration** - Multi-user workspaces, lead assignment
- [ ] **Map View** - Visualize leads geographically
- [ ] **Email Integration** - Send outreach directly from the app
- [ ] **Analytics** - Conversion tracking, pipeline metrics over time
