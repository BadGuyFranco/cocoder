# Write Boundaries Fragment
Do not mutate ignored dependency, build, or cache artifacts such as `node_modules/`, `dist/`, `.turbo/`.
Verification must be reproducible from tracked manifests, lockfiles, and declared commands.