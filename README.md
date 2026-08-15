# FalconForge

A comprehensive management app for FIRST Tech Challenge (FTC) robotics teams. Features sprint planning, scouting reports, and match planning - all with offline-first support.

## Features

- **Sprint Planning / Kanban Board** - Agile-style task management with Board, List, and Calendar views
- **Pre-Match Checklist** - Customizable checklists for competition day
- **Scouting Reports** - Track opponent capabilities during competitions
- **Match Planner** - Draw autonomous paths and game strategies on the field

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: TailwindCSS
- **State Management**: Zustand (with localStorage persistence)
- **Offline Storage**: IndexedDB via Dexie.js
- **Backend** (optional): Supabase (PostgreSQL + Auth)
- **PWA**: Installable on desktop, tablet, and mobile

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm or pnpm

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:3000`

## Running in Demo Mode

By default, the app runs in **Demo Mode** without any cloud services:
- All data is stored locally in your browser (localStorage + IndexedDB)
- No account required
- Works completely offline
- Perfect for trying out the app

## Enabling Cloud Features (Optional)

To enable cloud sync, authentication, and multi-device support:

### 1. Set up Supabase

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project
3. Go to Project Settings > API
4. Copy your Project URL and anon/public key

### 2. Configure Environment

Create/edit `.env.local` in the project root:

```env
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Set up Database Schema

Run these SQL commands in the Supabase SQL editor:

```sql
-- Users table (extends Supabase auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organizations (FTC Teams)
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  team_number TEXT,
  invite_code TEXT UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  owner_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own profile
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);
```

### 4. Enable Auth Providers (Optional)

In Supabase Dashboard > Authentication > Providers:
- Enable Google OAuth
- Enable Microsoft OAuth (Azure)
- Configure redirect URLs

## Building for Production

```bash
# Build the app
npm run build

# Preview the build
npm run preview
```

The built files will be in the `dist/` directory.

## PWA Installation

The app can be installed as a standalone app:

1. **Desktop (Chrome/Edge)**: Click the install icon in the address bar
2. **iOS Safari**: Tap Share > Add to Home Screen
3. **Android Chrome**: Tap the menu > Add to Home Screen

## Project Structure

```
falconforge/
├── src/
│   ├── lib/
│   │   ├── auth.tsx         # Authentication context
│   │   ├── supabase.ts      # Supabase client
│   │   ├── store.ts         # Zustand state management
│   │   ├── offline-db.ts    # IndexedDB schema
│   │   ├── sync.ts          # Offline sync logic
│   │   └── database.types.ts
│   ├── pages/
│   │   └── Login.tsx        # Login page
│   ├── components/
│   │   └── SyncStatusIndicator.tsx
│   ├── App.tsx              # Main app with routing
│   ├── main.tsx             # Entry point
│   └── index.css            # Global styles
├── components/              # Feature components (legacy location)
├── services/                # API services
├── public/                  # Static assets
└── index.html               # HTML template
```

## Roadmap

- [ ] Team invite system with shareable links
- [ ] Subscription management with Stripe
- [ ] Real-time collaboration
- [ ] Image/video uploads for task documentation

## License

MIT
