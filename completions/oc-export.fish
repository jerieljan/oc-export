# Fish completions for oc-export
# Copy this file to ~/.config/fish/completions/oc-export.fish
# Or keep it in this repo and run: ln -s (realpath completions/oc-export.fish) ~/.config/fish/completions/

# Options
complete -c oc-export -s h -l help -f -d "Show help message"
complete -c oc-export -l extractor -x -a "opencode claude" -d "Session source: opencode or claude"
complete -c oc-export -l session -x -d "Export a session by full ID or last 8 characters"
complete -c oc-export -l output -rF -d "Rename output files to <name>.jsonl and <name>.html"
complete -c oc-export -l raw -f -d "Skip sanitization"
complete -c oc-export -l no-raw -f -d "Enable sanitization (default, overrides raw: true in config)"
complete -c oc-export -l summarize -f -d "Summarize thinking and tool-call blocks using llm"
complete -c oc-export -l config -rF -d "Use a custom config file"

# Positional arguments: JSON/JSONL export files
complete -c oc-export -n "not __fish_seen_argument --session --output --help -h" -F
