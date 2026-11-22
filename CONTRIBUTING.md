# Contributing

Bug reports, test reports from devices other than a Bazzite PC, and pull requests are welcome. For a
larger change, open an issue first, so the approach is settled before you write the code.

## Setting up

You need Node.js with pnpm, Python 3.11 or newer, and bash.

```bash
pnpm install
pip install -r requirements-dev.txt
```

CI runs these checks, and they should pass before you open a pull request:

```bash
pnpm run typecheck
pnpm run build
ruff check .
shellcheck -S warning cartridge/lib.sh cartridge/agent/*.sh tools/*.sh examples/*/games/*/launch.sh
pytest
```

To try a change on a real machine, build and install it as described under Building in the
[README](README.md#building).

## Rules the code keeps

A cartridge has to be safe to plug into any machine, and these rules make sure of it:

- Saves, settings and caches stay on the machine, in `~/.local/share/game-cartridges/<game id>/`.
  Nothing a machine writes goes onto the cartridge.
- Only the agent adds Steam shortcuts. The plugin asks it to look again (SIGUSR1) and never adds
  shortcuts itself.
- A drive is erased only after the user has confirmed that drive, by model and size.
- The backend runs as root. Files it writes go through `backend/cart_worker.py`, which runs as the
  user.
- Changes to the cartridge layout are documented in [FORMAT.md](FORMAT.md). Older cartridges must keep
  working, so new manifest fields are optional and the format number stays 1.

## Pull requests

Keep a pull request to one change. In the description, say what you tested and on which device and
system. For UI changes, add a screenshot from Game Mode. Add a line for users to the top section of
[CHANGELOG.md](CHANGELOG.md).
