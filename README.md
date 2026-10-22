# OTT Finder

Type a movie or series and see which OTT apps in India have it (Netflix, Prime Video, JioHotstar, Apple TV, Zee5, SonyLIV and more), split into Stream / Free / Rent / Buy, with its **IMDb** and **Rotten Tomatoes** ratings.

- If it isn't on any Indian app, it says **Not available in India**, tells you if it's still in theatres or unreleased, and shows where it streams abroad.
- The home page lists **top-rated movies and series ranked by IMDb + Rotten Tomatoes**, with the Indian app each one is on. Filter by genre, actor, director, release period, minimum IMDb rating and minimum Rotten Tomatoes score. Lists refresh every 12 hours.

Data: TMDB watch providers (powered by JustWatch, region `IN`) and OMDb for ratings. Both are free.

## Setup

### 1. Get a TMDB token (for search and where to watch)
1. Sign up at https://www.themoviedb.org/signup and verify your email.
2. Open https://www.themoviedb.org/settings/api and click **Create** → **Developer**.
3. Fill the form (type: Personal, URL: your GitHub repo link, summary: "Personal app to check OTT availability in India").
4. Copy the **API Read Access Token** (the long one starting with `eyJ...`).

### 2. Get an OMDb key (for IMDb and Rotten Tomatoes ratings)
1. Go to https://www.omdbapi.com/apikey.aspx, choose **FREE (1,000 daily limit)**, and enter your email.
2. Open the email and click the activation link. The key won't work until you do this.
3. Copy the key (8 characters).

### 3. Deploy on Vercel
1. Go to https://vercel.com/new and import the `avig007/ottfinder` repo.
2. Framework preset: **Other**. Leave the build and output settings empty.
3. Open **Environment Variables** and add:
   - `TMDB_TOKEN` = your TMDB Read Access Token
   - `OMDB_KEY` = your OMDb key
4. Click **Deploy**. When it's done, open the URL Vercel gives you.

If you added the variables after the first deploy, go to **Deployments → ⋯ → Redeploy** so they take effect.

### 4. Turn on AI search and voice
AI search lets you describe what you want ("feel-good Hindi comedies on Netflix", "movies like Interstellar", "the film where a man relives the same day"). The mic button turns speech into a search. Both use the same AI keys as CutTrack: OpenAI first, then Gemini, then Groq if one runs out.

Add these in Vercel → ottfinder → Settings → **Environment Variables**:
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`: the same keys you use for CutTrack (any one is enough; more = backups)

Then go to **Deployments → ⋯ → Redeploy**.

Prefer keeping keys as GitHub secrets, like CutTrack? Add `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` and `VERCEL_TOKEN` under this repo's Settings → Secrets and variables → Actions, then run **Actions → Sync keys to Vercel → Run workflow**. It copies them into Vercel and redeploys.

### 5. Put it on your iPhone
Open the Vercel URL in Safari → Share → **Add to Home Screen**.

## Notes
- Rotten Tomatoes scores come from OMDb, which often has them for movies but not for series. Series without one show only IMDb.
- Brand-new releases can take a few days to get ratings.

## Files
- `public/index.html`: the app screen
- `api/search.js`: finds matching movies and series
- `api/title.js`: where to watch in India, ratings, release status, availability abroad
- `api/recommend.js`: top-rated picks for the home page, with filters
- `api/people.js`: actor and director suggestions for the filters
- `api/img.js`: serves posters from your own domain (works on networks that block TMDB)
- `api/_justwatch.js`, `api/_apps.js`: India prices and the included / pay-extra answer per app
- `api/ask.js`: AI search (the AI plans the search; availability, prices and ratings always come from live data)
- `api/transcribe.js`: voice to text
- `api/_ai.js`: AI providers with automatic fallback (same as CutTrack); `api/_guard.js`: request handling and a 60-per-hour limit per device
- `api/_enrich.js`: adds ratings and included-with apps to a list of titles
- `api/batch.js`: live ratings and where-to-watch for the titles in a watchlist
- `public/icons/`: app logo and home-screen icons
- `api/_tmdb.js`, `api/_omdb.js`: shared helpers (read `TMDB_TOKEN` and `OMDB_KEY`)
