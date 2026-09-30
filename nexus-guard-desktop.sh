#!/usr/bin/env bash
cd "/home/saadi/Documents/ChatGPT/nexus guard" || exit 1
export PATH="$HOME/.nvm/versions/node/v26.3.0/bin:$HOME/.cargo/bin:$PATH"
exec npm run tauri dev
