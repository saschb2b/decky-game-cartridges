# Security

The plugin's backend runs as root, because formatting a drive needs it. If you find a way to make the
plugin or the cartridge agent do something the user did not ask for, report it privately through
[GitHub's vulnerability reporting](https://github.com/saschb2b/decky-game-cartridges/security/advisories/new)
rather than in a public issue. Include the plugin version and the steps to reproduce it.

Running a cartridge's `launch.sh` when the user presses Play is how cartridges work, not a
vulnerability. That is why the README asks to plug in only cartridges you trust.
