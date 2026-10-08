# Code signing

The release workflow (`.github/workflows/release.yml`) signs the macOS builds
when the Apple secrets exist. Without them it builds unsigned, as before. No
secret is required for a build to succeed.

## What you must do by hand

### macOS

1. **Enroll in the Apple Developer Program** (USD 99 per year). Enrollment
   from Algeria is not confirmed; try it on the Apple developer site. Nothing
   in this repo can do this for you.
2. **Create a "Developer ID Application" certificate.** In Xcode
   (Settings, Accounts, Manage Certificates) or on developer.apple.com.
3. **Export the certificate as a `.p12` file** from Keychain Access, with a
   password. Then base64 it:

   ```sh
   base64 -i certificate.p12 -o certificate.base64
   ```

4. **Create an app-specific password** at appleid.apple.com (Sign-In and
   Security, App-Specific Passwords). Use this, not your Apple ID password.
5. **Find your Team ID** in the developer portal (Membership details).
6. **Set the secrets** in the GitHub repo. Run these from the repo root. Where
   no `--body` is given, `gh` prompts for the value, so it stays out of your
   shell history. Never commit these values or the certificate files:

   ```sh
   gh secret set APPLE_CERTIFICATE --body "$(cat certificate.base64)"
   gh secret set APPLE_CERTIFICATE_PASSWORD
   gh secret set APPLE_SIGNING_IDENTITY --body "Developer ID Application: Your Name (TEAMID)"
   gh secret set APPLE_ID --body "you@example.com"
   gh secret set APPLE_PASSWORD
   gh secret set APPLE_TEAM_ID --body "TEAMID"
   ```

   `gh secret set NAME` without `--body` prompts for the value. Then delete the
   local `certificate.p12` and `certificate.base64` files.

Secrets are only the six names above. Add them all, or the build stays
unsigned (signing needs the certificate and identity; notarization needs the
Apple ID, app-specific password and Team ID).

### Windows

Windows is not signed yet. Two routes exist:

- **SignPath** (free for open-source projects). It needs an OSI-approved
  license in the repo; there is none yet. The owner must choose a license
  first. The workflow would then upload the built installer to SignPath after
  the build.
- **Paid certificate** (OV, about USD 220 or more per year, plus a hardware
  token or cloud HSM). Hard for an individual without a company. Configured in
  `src-tauri/tauri.conf.json` under `bundle.windows.signCommand`, not from a
  secret.

Azure Trusted Signing is not an option: it is limited to individuals in the
USA and Canada.

## How to tell from the workflow log whether signing ran

Open the run, then the macOS job, and look at the step
**"Apple signing setup (macOS, only if secrets exist)"**. It prints:

- `macOS signing: on` or `macOS signing: off (unsigned build)`
- `macOS notarization: on` or `macOS notarization: off`

Values are never printed. In the tauri-action step, a signed build also logs
`Signing` and `Notarizing` lines. To confirm on a downloaded build, run on a
Mac:

```sh
codesign -dv --verbose=4 "/Applications/Nexus Guard.app"
spctl -a -vv "/Applications/Nexus Guard.app"
```

`spctl` should say `accepted` with `source=Notarized Developer ID`.

## Known gaps (not yet verified)

- **Sidecars.** The app ships `nexus-keyring` and `nexus-server` as
  `externalBin`. The Tauri docs do not say whether these are signed with the
  app's identity. Check each one with `codesign -dv` on the first signed
  build.
- **Node entitlements.** `nexus-server` is a Node binary. Under the hardened
  runtime that notarization requires, it may need JIT entitlements. Check that
  the packaged server still starts after notarization.

## Windows reputation

Even a signed Windows installer triggers SmartScreen warnings until the
certificate or file builds reputation over time. Extended-validation
certificates no longer skip that wait. Expect warnings for the first releases.
