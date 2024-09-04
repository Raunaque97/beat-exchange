#!/bin/sh

# Check if a bot name was provided
if [ -z "$1" ]; then
    echo "Please provide a bot name. Usage: pnpm run start <botName>"
    exit 1
fi

# Construct the path to the bot script
BOT_SCRIPT="dist/scripts/$1.js"

# Check if the bot script exists
if [ ! -f "$BOT_SCRIPT" ]; then
    echo "Bot script $BOT_SCRIPT not found."
    exit 1
fi

# Run the bot script with the required Node.js flags
node --experimental-vm-modules --experimental-wasm-modules --experimental-wasm-threads --es-module-specifier-resolution=node "$BOT_SCRIPT"