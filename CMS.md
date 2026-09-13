# Nitya Lanka — site + content manager

The site is still the same hand-written HTML it always was. A small
Node/Express server now sits in front of it: it parses each page, exposes
every piece of text as an editable field, and re-renders the page with the
client's wording applied. Nothing is generated, templated or rewritten on
disk — the HTML files remain the source of truth for layout.

```
admin/            the content manager UI (login + editor)
server/           express app, field extraction, content store
assets/  *.html   the public site, unchanged
data/             runtime state - content, uploads, snapshots  (gitignored)
```

## Running it locally

```bash
npm install
npm start
```

- Site — <http://localhost:3000/>
- Admin — <http://localhost:3000/admin>

On first run an admin account is created and the password is printed to the
console **once**. Set `ADMIN_USER` / `ADMIN_PASSWORD` to choose your own:

```bash
ADMIN_USER=nitya@example.com ADMIN_PASSWORD='a-good-password' npm start
```

Lost the password? `npm run reset-password -- nitya@example.com newpassword`

## How editing works

Edits save to a **draft** the moment they are typed. The public site keeps
serving the last **published** version until someone presses **Publish**.

```
client types  ->  draft  ->  [Preview]        (only signed-in admins see this)
                     |
                 [Publish]  ->  live site     (what visitors get)
```

- **Publish** — pushes every pending change live, and snapshots the previous
  state first.
- **Discard changes** — throws the draft away and goes back to what is live.
- **Version history** — every publish leaves a snapshot (50 kept). Restoring
  loads it back into the *draft*, so a restore still goes through Publish.
- **Reset** (per field) — returns that one item to its original wording.

## What the client can change

| | |
|---|---|
| Text | Every heading, paragraph, stat, tag, card, button label and link label across all six pages — 315 fields in total. Bold, italic and links are preserved. |
| Links | The destination of any link. |
| Images | Replace the fixed image slots (such as the homepage portrait), **and add new images** to any section. |
| Video | Add a video to any section — paste a YouTube or Vimeo link, or upload an MP4/WebM/MOV. |
| Files | Swap the Banyan Nation research PDF, or add new downloads. |
| Logo | Upload a logo once; it replaces the "NL" initials in the header and footer of **every** page. |
| SEO | Page title and search description per page. |
| Show / hide | Switch any single item, or a whole section, off the site without deleting it — and back on later. |

### The logo

The logo is a site-wide setting rather than a field per page - it appears
in the header and footer of all six pages, so it is uploaded once under
**Logo (all pages)** and applied everywhere. With nothing uploaded the
original "NL" initials mark is used, and clearing the logo returns to it.

### Adding images and video

Every section in the editor ends with **+ Add an image or video here**. Each
item added becomes a captioned block at the foot of that section: one item
runs full width, two or more lay out side by side, and everything scales
down on a phone. Items can be reordered, switched between image and video,
and removed.

Video accepts either a pasted **YouTube or Vimeo link** — turned into a
privacy-friendly `youtube-nocookie` embed server-side — or an uploaded
video file, which plays in the browser's own player. Links to anywhere else
are refused rather than embedded.

**Not** editable without a developer: page layout, and adding new *structured*
items — a fifth stat, another card in the four-card grid. Hiding covers most
of the "remove this" requests, and the media blocks cover "add a picture
here"; new structured items would mean rebuilding those grids as
data-driven templates.

### Safety

Anything typed into the editor is sanitised server-side before it reaches a
page: scripts, event handlers, `javascript:` URLs and block-level markup are
stripped, and only inline formatting (`<em> <strong> <a> <br>` …) survives.
The client cannot break the layout or inject code through the editor.

Media blocks are assembled server-side from validated fields rather than
from typed markup — which is what makes it safe to emit a video `<iframe>`
at all. Image sources must resolve to a file this server is already serving;
remote hotlinking, `data:` URLs and lookalike hosts such as
`youtube.com.evil.com` are all rejected.

## Deploying on Dokploy

The old nginx image served static files only; a CMS needs a running process,
so the `Dockerfile` now builds a Node image. (`nginx.conf` is left in the
repo for reference but is no longer used.)

```
Build   : Dockerfile
Port    : 3000
Volume  : <named volume>  ->  /app/data        <-- REQUIRED
```

> **The volume is not optional.** All content, uploads and version snapshots
> live in `/app/data`. Without a mounted volume every redeploy silently
> resets the site to its original wording and deletes uploaded images. This
> is verified behaviour, not a theory — a container started without the
> volume comes back with the client's edits gone.

Environment:

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_USER` | `admin` | Use the client's email address. |
| `ADMIN_PASSWORD` | generated | Set this explicitly. Changing it re-rotates the login on the next deploy. |
| `PORT` | `3000` | |
| `BASE_PATH` | *(empty)* | Set to `/nithya` to serve under a path prefix. |
| `DATA_DIR` | `/app/data` | Where content and uploads live. |
| `MAX_UPLOAD_MB` | `25` | Per-file upload cap. |

Sessions are signed cookies (14 days, `HttpOnly`, `SameSite=Lax`, `Secure`
behind TLS) keyed on a secret stored in the volume — so redeploys do not
sign the client out.

### Backing up

`data/content.json` is the whole site's content. Copy it, and
`data/uploads/`, and you have a complete backup.

## Handing it to a client

1. Deploy with `ADMIN_USER` set to their email and a password you choose.
2. Send them the `/admin` URL and those credentials.
3. Ask them to change the password under **Account** once they are in.

The panel explains the draft/publish model in the sidebar, and every
destructive action asks for confirmation first.
