def clip($s; $n): ($s // "") | tostring | if (length > $n) then (.[0:$n] + "…") else . end;

. as $line
| (try ($line | fromjson) catch null) as $e
| if $e == null then
    (if ($line | test("\\S")) then "  · " + $line else empty end)
  elif ($e.type == "system" and $e.subtype == "init") then
    "  model " + ($e.model // "?") + "  ·  mode " + ($e.permissionMode // "?")
    + "\n  session " + ($e.session_id // "?")
    + "\n  resume with: claude --resume " + ($e.session_id // "?")
  elif $e.type == "assistant" then
    ( $e.message.content[]?
      | if .type == "text" then
          (if (.text | test("\\S")) then ("  " + clip(.text; 400)) else empty end)
        elif .type == "tool_use" then
          "  → " + .name + "  "
          + clip(( .input.command // .input.file_path // .input.pattern
                 // .input.description // .input.prompt // (.input | tostring) ); 90)
        else empty end )
  elif $e.type == "user" then
    ( $e.message.content[]?
      | select(.type == "tool_result" and (.is_error == true))
      | "  ✗ tool error: " + clip((.content | if type == "array" then (.[0].text // tostring) else tostring end); 160) )
  elif $e.type == "result" then
    "  ── " + ($e.subtype // "?")
    + " · " + (((($e.duration_ms // 0) / 1000) | floor | tostring)) + "s"
    + " · " + (($e.num_turns // 0) | tostring) + " turns"
    + " · $" + (((($e.total_cost_usd // 0) * 100) | round) / 100 | tostring)
  else empty end
