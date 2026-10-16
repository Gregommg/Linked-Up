# Linked Up (Coil-ition)

Cooperative multiplayer snake. Up to 4 players share ONE snake and each controls different directions, so you must coordinate out loud.

## Features
- Accounts: sign in with **username or email** + password
- Friends: send request -> they accept -> you are friends
- Live presence: **Online / In a game / Offline**. Invite button only shows for friends who are online
- Rooms: 4-letter code or friend invite, **max 4 players**
- Directions are shuffled every round; with fewer than 4 players, directions are shared out
- Keyboard (arrows / WASD) and on-screen touch buttons
- Realistic rounded snake segments and animated food
- Golden bonus food has a 20% chance to appear each time normal food is eaten, is worth a random 3–10 points, and stays on the board for up to 6 seconds
- **Snake Clash:** teams of up to 4 control separate snakes in a shared arena and compete for the highest food score
- Clash hosts choose a 2-, 3-, or 5-minute match, or play until all teams are eliminated; crash rules can respawn teams (3 lives, -20 points per respawn), eliminate a team, or end the match
- Clash high scores are credited to participating team members. Players choose Public (global leaderboard with username), Private (their dashboard only), or Hidden (not displayed).

## Play Snake Clash
1. Create a team room and gather up to 4 players.
2. The team host creates a clash arena and chooses its duration and crash rule. That whole team moves into the arena.
3. Other team hosts create their own team rooms, enter the arena code, and join with their whole team. Up to 4 teams can compete.
4. The arena host starts the clash once at least 2 teams have joined. Each teammate controls assigned directions for their team's snake.
5. The team with the highest score when the match ends wins. A tie is shared.

## Run locally
1. Install Node.js 24.20.0 (also specified in `.node-version`) and create a Neon PostgreSQL project.
2. Copy `.env.example` to `.env`; set `DATABASE_URL` to Neon's connection string and set `JWT_SECRET` to a long random secret.
3. `npm install && npm start`
4. Open http://localhost:3000 in several browser tabs/accounts
5. Run `npm test` to execute the game logic tests

The PostgreSQL tables are created automatically when the server starts. This migration starts with an empty Neon database; existing MongoDB accounts and friendships are not copied.

## Deploy the multiplayer backend to Railway with Neon
1. Push the project to GitHub.
2. Create a Neon project and copy its PostgreSQL connection string from the **Connect** dialog. Use Neon's pooled connection string for the app service.
3. In Railway, create a project from the GitHub repository and deploy the Node.js service. Railway uses the included `railway.json` to start the backend.
4. In the Railway service's **Variables** settings, set `DATABASE_URL` to the Neon connection string and set `JWT_SECRET` to a long, random secret.
5. Deploy, then generate a public domain in Railway's **Settings → Networking** and copy its HTTPS URL.

The backend must remain on an always-on Node host: it uses Express, Neon PostgreSQL, and persistent Socket.IO connections for live multiplayer. Netlify hosts the frontend, not this Socket.IO server.

If your previous MongoDB connection string or password was shared or committed, rotate that database password in Atlas. This app no longer reads `MONGODB_URI`.

## Deploy the frontend to Netlify
1. In Netlify, choose **Add new site → Import an existing project** and connect the same GitHub repository.
2. Netlify reads `netlify.toml` for its build command and `dist` publish directory.
3. In the Netlify site's environment variables, set `BACKEND_URL` to the Railway HTTPS origin (for example `https://linked-up-production.up.railway.app`; no path or trailing API route).
4. Trigger a deploy. The build copies `public/` to `dist/` and writes the backend URL into the generated `config.js`.
5. Open the Netlify site URL, register an account, and test sign-in and multiplayer. Keep `BACKEND_URL` configured for every deploy context you use.

To test the Netlify build locally in PowerShell:

```powershell
$env:BACKEND_URL = "https://linked-up-production.up.railway.app"
npm run build:netlify
```

Do not use `npm start` as Netlify's build command; Netlify serves the generated static frontend, while Railway runs the multiplayer backend.

## Android and iOS (Capacitor wraps the same web app)
1. Deploy the server first, then set `window.API_BASE` in `public/config.js` to your server URL (e.g. `https://linked-up-production.up.railway.app`)
2. `npm install`
3. `npx cap add android` and/or `npx cap add ios`
4. `npx cap sync`
5. `npm run cap:android` (Android Studio) or `npm run cap:ios` (Xcode, Mac only)

### Google Play
Android Studio -> Build -> Generate Signed Bundle (.aab) -> upload in Play Console ($25 one-time fee).

### Apple App Store
Needs a Mac + Apple Developer account ($99/year). In Xcode: Product -> Archive -> Distribute. Apple expects more than a plain website, so add native features such as push notifications (below). Account deletion is already built in (required by Apple).

### Direct download
Build a signed APK in Android Studio (Build -> Build APK) and put it at `public/downloads/linked-up.apk`. The sign-in page already links to it.

## Not included yet (next steps)
- **Push notifications** for invites when the app is closed: add `@capacitor/push-notifications` + Firebase, and send a push from the `invite:send` handler in `server/index.js`
- Desktop builds (Electron/Tauri) could wrap `public/` the same way
- Privacy policy page (both stores require one)
- Password reset by email
