# Linked Up (Coil-ition)

Cooperative multiplayer snake. Up to 4 players share ONE snake and each controls different directions, so you must coordinate out loud.

## Features
- Accounts: sign in with **username or email** + password
- Friends: send request -> they accept -> you are friends
- Live presence: **Online / In a game / Offline**. Invite button only shows for friends who are online
- Rooms: 4-letter code or friend invite, **max 4 players**
- Directions are shuffled every round; with fewer than 4 players, directions are shared out
- Keyboard (arrows / WASD) and on-screen touch buttons

## Run locally
1. Install Node 18+ and MongoDB (or use a free MongoDB Atlas URI)
2. `cp .env.example .env` and edit `MONGODB_URI` and `JWT_SECRET`
3. `npm install && npm start`
4. Open http://localhost:3000 in several browser tabs/accounts

## Deploy (web) on Render
Push to GitHub, create a Render Web Service (`render.yaml` is included), set `MONGODB_URI` (MongoDB Atlas). Players then open your Render URL.

## Android and iOS (Capacitor wraps the same web app)
1. Deploy the server first, then set `window.API_BASE` in `public/config.js` to your server URL (e.g. `https://linked-up.onrender.com`)
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
