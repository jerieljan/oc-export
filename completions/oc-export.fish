# Fish completions for oc-export
# Copy this file to ~/.config/fish/completions/oc-export.fish
# Or keep it in this repo and run: ln -s (realpath completions/oc-export.fish) ~/.config/fish/completions/

# Options
complete -c oc-export -s h -l help -f -d "Show help message"
complete -c oc-export -l session -x -d "Export a session by full ID or last 8 characters"
complete -c oc-export -l output -rF -d "Rename output files to <name>.json and <name>.html"
complete -c oc-export -l raw -f -d "Skip sanitization (enabled by default)"

# Positional arguments: JSON export files
complete -c oc-export -n "not __fish_seen_argument --session --output --help -h" -F
