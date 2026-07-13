#!/usr/bin/env bash
# PreToolUse (Bash): block obviously destructive commands.
# exit 2 = block the tool call; stderr is shown to Claude as the reason.
INPUT=$(cat)
cmd=$(echo "$INPUT" | jq -r ".tool_input.command // empty")
if echo "$cmd" | grep -qE "rm -rf /|rm -rf ~|git push --force|git reset --hard origin|DROP (TABLE|DATABASE)|> \.env"; then
  echo "Blocked by guard-bash hook: destructive command. Ask the user explicitly." 1>&2
  exit 2
fi
exit 0
