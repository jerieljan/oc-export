# Copy to ~/.config/fish/completions/oc-export.fish, then restart Fish or source it.
# Dynamic suggestions need oc-export on PATH (for example, npm install -g oc-export).

function __oc_export_sessions
    set -l tokens (commandline --current-process --tokens-expanded --cut-at-cursor)
    set -l options
    set -l pending
    # Forward only source/config options. Never evaluate command-line text.
    for token in $tokens[2..-1]
        if test -n "$pending"
            switch $pending
                case --extractor --config
                    set -a options "$pending" "$token"
            end
            set pending
            continue
        end
        switch $token
            case --extractor --config --output --session --limit
                set pending "$token"
            case '--extractor=*' '--config=*'
                set -a options "$token"
        end
    end
    # ls already strips tabs/newlines/control characters from each cell.
    # Suppress missing-source errors during completion and discard the header.
    set -l rows (command oc-export ls $options 2>/dev/null)
    or return
    for row in $rows[2..-1]
        set -l cells (string split \t -- "$row")
        if test (count $cells) -eq 4
            printf '%s\t%s — %s\n' "$cells[1]" "$cells[4]" "$cells[3]"
        end
    end
end

complete -c oc-export -s h -l help -f -d "Show help for this command"
complete -c oc-export -l extractor -x -a "opencode opencode2 claude pi codex" -d "Local session source"
complete -c oc-export -l config -rF -d "Read settings from a JSON or JSONC file"
complete -c oc-export -n "not __fish_seen_subcommand_from ls" -l session -x -a '(__oc_export_sessions)' -d "Session ID (full ID or unique last 8 characters)"
complete -c oc-export -n "not __fish_seen_subcommand_from ls" -l output -rF -d "Output base path"
complete -c oc-export -n "not __fish_seen_subcommand_from ls" -l raw -f -d "Skip HTML sanitization"
complete -c oc-export -n "not __fish_seen_subcommand_from ls" -l no-raw -f -d "Enable HTML sanitization (default)"
complete -c oc-export -n "not __fish_seen_subcommand_from ls" -l summarize -f -d "Summarize thinking and tool calls using llm"
complete -c oc-export -n "__fish_seen_subcommand_from ls" -l json -f -d "Print a JSON array for scripts and agents"

complete -c oc-export -n "not __fish_seen_subcommand_from ls; and not __fish_seen_argument -l session -l help -s h" -F
complete -c oc-export -n "not __fish_seen_subcommand_from ls; and not __fish_seen_argument -l session" -a ls -d "List recent sessions"
complete -c oc-export -n "__fish_seen_subcommand_from ls" -a "(__fish_complete_directories)" -f

complete -c oc-export -n "__fish_seen_subcommand_from ls" -l json-extended -f -d "Extended JSON with coverage and diagnostics"
complete -c oc-export -n "__fish_seen_subcommand_from ls" -l all -f -d "Retrieve all sessions"
complete -c oc-export -n "__fish_seen_subcommand_from ls" -l limit -x -d "Maximum sessions, independently of picker limits"
