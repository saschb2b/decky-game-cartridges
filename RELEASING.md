# Releasing

1. Set the new `version` in `package.json` and add a section for it at the top of `CHANGELOG.md`,
   headed `## <version>`.
2. Commit and push to `main`, and wait for CI to pass.
3. Tag the commit and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

The Release workflow runs the CI checks again, checks that the tag matches `package.json` and that
`CHANGELOG.md` has a section for the version, and then publishes a GitHub release. The release has
`game-cartridges.zip` attached and the changelog section as its notes.

The install link in the README always points at the zip of the latest release, so a new release is
what people get from then on. Decky Loader does not offer updates for plugins installed from a URL,
so existing users update by installing from the same link again.
