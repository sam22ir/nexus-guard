import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { bindingScopesPath } from "./binding-scopes.mjs";
import { homeDir, nexusConfigDir } from "./config-dir.mjs";
import { keyringBinary } from "./nexus-server.mjs";
import { customServicesPath } from "./providers.mjs";
import { vaultStatePath } from "./vault-state.mjs";
import { writeGrantsPath } from "./write-grants.mjs";

// The same cases are checked on the Rust side (`config_dir_per_platform` in
// src-tauri/src/lib.rs), so the app and the server pick the same folder.

test("config folder: Linux uses XDG_CONFIG_HOME, else ~/.config", () => {
  assert.equal(nexusConfigDir({ HOME: "/home/u" }, "linux"), "/home/u/.config/nexus-guard");
  assert.equal(nexusConfigDir({ HOME: "/home/u", XDG_CONFIG_HOME: "/home/u/cfg" }, "linux"), "/home/u/cfg/nexus-guard");
  assert.equal(nexusConfigDir({ HOME: "/home/u", XDG_CONFIG_HOME: "relative" }, "linux"), "/home/u/.config/nexus-guard", "a relative XDG path is ignored");
  assert.equal(nexusConfigDir({ HOME: "/home/u", XDG_CONFIG_HOME: "  " }, "linux"), "/home/u/.config/nexus-guard");
});

test("config folder: macOS uses Application Support", () => {
  assert.equal(nexusConfigDir({ HOME: "/Users/u" }, "darwin"), "/Users/u/Library/Application Support/nexus-guard");
  assert.equal(nexusConfigDir({ HOME: "/Users/u", XDG_CONFIG_HOME: "/x" }, "darwin"), "/Users/u/Library/Application Support/nexus-guard");
});

test("config folder: Windows uses APPDATA, else the profile's Roaming folder", () => {
  assert.equal(nexusConfigDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32"), "C:\\Users\\u\\AppData\\Roaming\\nexus-guard");
  assert.equal(nexusConfigDir({ USERPROFILE: "C:\\Users\\u" }, "win32"), "C:\\Users\\u\\AppData\\Roaming\\nexus-guard");
});

test("config folder: NEXUS_CONFIG_DIR wins everywhere", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    assert.equal(nexusConfigDir({ HOME: "/home/u", APPDATA: "C:\\x", NEXUS_CONFIG_DIR: "/custom/dir" }, platform), path.resolve("/custom/dir"));
  }
});

test("home folder: HOME, then USERPROFILE", () => {
  assert.equal(homeDir({ HOME: "/home/u", USERPROFILE: "C:\\Users\\u" }), "/home/u");
  assert.equal(homeDir({ HOME: "", USERPROFILE: "C:\\Users\\u" }), "C:\\Users\\u");
});

test("every settings file lives in the one config folder", () => {
  const env = { NEXUS_CONFIG_DIR: "/cfg" };
  const dir = path.resolve("/cfg");
  assert.equal(writeGrantsPath(env), path.join(dir, "write-grants.json"));
  assert.equal(bindingScopesPath(env), path.join(dir, "binding-scopes.json"));
  assert.equal(customServicesPath(env), path.join(dir, "custom-services.json"));
  assert.equal(vaultStatePath(env), path.join(dir, "vault-state.json"), "no runtime folder: the vault state sits with the settings");
  assert.equal(vaultStatePath({ ...env, XDG_RUNTIME_DIR: "/run/user/1" }), path.join("/run/user/1", "nexus-guard-vault-state.json"));
  assert.equal(vaultStatePath({ ...env, NEXUS_VAULT_STATE_FILE: "/v/state.json" }), path.resolve("/v/state.json"));
});

test("keychain helper: the app's copy, else the debug build with the right file name", () => {
  assert.equal(keyringBinary({ NEXUS_KEYRING_BIN: "/opt/nexus/nexus-keyring" }, "linux"), "/opt/nexus/nexus-keyring");
  assert.match(keyringBinary({}, "win32"), /nexus-keyring\.exe$/);
  assert.match(keyringBinary({ NEXUS_KEYRING_BIN: " " }, "linux"), /target[\\/]debug[\\/]nexus-keyring$/);
});
