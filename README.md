# ALAW

All Leeds Aren't We: the Leeds United away day hub. Fans can see who's going, rate pubs near the ground, offer lifts, post spare or wanted tickets (official club transfer only), set up meet-ups, share photos and chat.

No npm packages. Node 18 or newer. Start it with `node server.js`.

## Settings (Render → Environment)

| Name | What it's for |
|---|---|
| `API_FOOTBALL_KEY` | Loads Leeds fixtures automatically. It makes about 6 calls a day. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Permanent storage. Without these, everything is wiped on each deploy. It can be the same database as StatsPack, because ALAW keeps its data under `alaw:`. |
| `ADMIN_KEY` | A password you make up (at least 8 characters). Unlock admin at `/#/admin`. |
| `CF_ANALYTICS_TOKEN` | Optional. Turns on Cloudflare visitor stats. |
| `LEEDS_TEAM_ID` | Optional. Defaults to 63. |

Never put keys in this repo.

## Moderation

- Anything reported by 3 different fans is hidden automatically.
- Admin can hide, delete or dismiss reported items, and ban users.
- Users can block each other.
