# Putting a release on the website

The download section reads `public/release.json`. While `status` is
`"waitlist"`, visitors see the email form. Set it to `"available"` with at
least one download and the page shows download buttons instead, picking the
visitor's system first. No code change is needed.

```json
{
  "status": "available",
  "version": "0.1.0",
  "date": "2026-10-20",
  "notes": "https://example.com/nexus/0.1.0",
  "downloads": [
    { "os": "linux", "label": "Linux (.deb)", "url": "https://…/nexus-guard_0.1.0_amd64.deb" },
    { "os": "linux", "label": "Linux (.AppImage)", "url": "https://…/nexus-guard_0.1.0_amd64.AppImage" },
    { "os": "macos", "label": "macOS (Apple Silicon)", "url": "https://…/Nexus.Guard_0.1.0_aarch64.dmg" },
    { "os": "macos", "label": "macOS (Intel)", "url": "https://…/Nexus.Guard_0.1.0_x64.dmg" },
    { "os": "windows", "label": "Windows (.msi)", "url": "https://…/Nexus.Guard_0.1.0_x64_en-US.msi" }
  ]
}
```

Rules the page enforces: `os` is `linux`, `macos` or `windows`, and every
`url` (and `notes`) must start with `https://`. Anything else is ignored, and
with no valid download the page stays on the waitlist.

## Where the installers live

The GitHub repository is private, so its release files are not downloadable
by visitors. Before going live, put the installers somewhere public, for
example a public Cloudflare R2 bucket, or make the repository public. Then:

1. Build the installers (`.github/workflows/release.yml` makes a draft release).
2. Upload them to the public location and check each link in a private window.
3. Edit `public/release.json`, then `npm run deploy` from this folder.
4. Email the waitlist (the `signups` table in the `nexus-waitlist` D1 database).
