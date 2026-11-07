# Funqtion Requests server (app 9)

The guest page and the live request queue run on **your own server** with [PocketBase](https://pocketbase.io): one program and one data folder, so there's no hosting bill. Guests reach it over the internet through a free tunnel, so you don't have to open any ports on your router.

```
server/requests/
  pb_migrations/   database layout: sessions, requests, votes, blocks (applied automatically)
  pb_hooks/        guest and DJ routes, spam limits, word filter, 30-day clean-up
  pb_public/       the guest page (index.html, app.js, style.css, privacy.html)
```

Tested with PocketBase **v0.40.6**.

## 1. Install (on the home server: a Mac mini, NAS, Raspberry Pi or old laptop)

1. Download PocketBase for your machine from <https://github.com/pocketbase/pocketbase/releases> (e.g. `pocketbase_0.40.6_linux_arm64.zip` for a Raspberry Pi, `darwin_arm64` for an M-series Mac).
2. Put the `pocketbase` program in a folder, for example `~/funqtion-requests/`.
3. Copy `pb_migrations`, `pb_hooks` and `pb_public` from this repo folder into that same folder.
4. Create your admin login. This is only for you, and isn't one of the DJ accounts:

   ```bash
   ./pocketbase superuser upsert jij@example.nl 'een-lang-wachtwoord'
   ```

5. Start PocketBase:

   ```bash
   ./pocketbase serve --http 127.0.0.1:8090
   ```

   This applies the database layout automatically. Keep it running: as a service (systemd or launchd), in `tmux`, or as a login item on a Mac.
6. Open <http://127.0.0.1:8090/_/> on the server and create the two DJ accounts under **Collections → users → New record**: Gijs and Coen, each with an e-mail address and password. Public sign-up is switched off, so nobody else can make an account.

## 2. Make it reachable for guests (free, no open ports)

You need one of these two options.

**Option A: Cloudflare Tunnel.** Use this if you have your own domain. It gives you a nice address such as `https://verzoek.jouwdomein.nl`.

1. Add your domain to a free Cloudflare account. Its DNS must be managed by Cloudflare.
2. Install `cloudflared` on the server, then run:

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create funqtion-requests
   cloudflared tunnel route dns funqtion-requests verzoek.jouwdomein.nl
   ```

3. Create `~/.cloudflared/config.yml` with:

   ```yaml
   tunnel: funqtion-requests
   credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: verzoek.jouwdomein.nl
       service: http://127.0.0.1:8090
     - service: http_status:404
   ```

4. Start it with `cloudflared tunnel run funqtion-requests`, or install it as a service with `cloudflared service install`.

**Option B: Tailscale Funnel.** Use this if you don't have a domain. Your address becomes `https://<server>.<tailnet>.ts.net`.

1. Install Tailscale on the server and log in.
2. Run:

   ```bash
   sudo tailscale funnel --bg 8090
   ```

Free tiers and limits change, so check the current terms on each service's site.

## 3. Connect the hub

In the hub, open **Funqtion Requests → Server**:

1. Fill in the address (e.g. `https://verzoek.jouwdomein.nl`).
2. Log in with your DJ account.

After that, on each gig:

- **Verzoekjes starten** creates the session. It takes these from the rest of the hub:
  - the code
  - the pause windows during the special moments (from Gig Day)
  - the do-not-plays (from Bookings and Sets)
  - wedding mode with the couple's names and a priority code
  - the library index (artist and title only)
- **QR-kaart** prints the table card.

## 4. What guests can and can't do

- **No accounts.** A random code on the phone prevents double votes. The server only stores a hash of it, per party.
- **Search** covers your library (they only see matches, never your whole collection) plus the Deezer catalogue, via the server. Guests' phones only talk to your server.
- **Limits:**
  - 3 open requests per phone, 10 per hour, 40 per network per 10 minutes
  - one vote per request per phone
  - the same song requested twice becomes one request with an extra vote
- **Filtered:** insults (NL/EN, including l33t spelling), links, emoji walls, blocked tracks and artists, and explicit songs at family parties.
- **Shout-outs** only become public after a DJ approves them.
- **Pause windows**, for example the first dance, show "Even geen verzoekjes: Openingsdans 💛".

## 5. Privacy (AVG)

- **Never stored:** IP addresses (they're kept in memory for 10 minutes, only against spam), e-mail addresses and phone numbers.
- **Clean-up every night (04:17):**
  - sessions left open for more than 36 hours are closed
  - 30 days after a session closes, its names, shout-outs, phone hashes, votes and library index are deleted
  - what stays is only which songs were asked, without any personal data
- **The privacy page** is at `/privacy.html` (NL/EN) and is linked from the guest page.

## 6. Backups and updates

- **Back up** the `pb_data` folder (copy it, or use the admin UI under Settings → Backups).
- **Update** by replacing the `pocketbase` program and the three folders, then restart. Migrations run by themselves.

## 7. Development

The tests in `src/apps/requests/domain.test.ts` load `pb_hooks/lib/requests.js` directly, so the server's helper rules are checked in `npm test`.

To try the server locally:

```bash
pocketbase serve --http 127.0.0.1:8090 --dir ./pb_data --hooksDir ./pb_hooks --migrationsDir ./pb_migrations --publicDir ./pb_public
```
