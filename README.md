# TRMNL Tray

Simple tray/menubar app that displays the current TRMNL screen image.

## Run (dev)

1. `npm install`
2. `npm start`
3. Click the tray/menubar icon, paste your TRMNL `access-token`, press **Refresh**.

The app saves your token locally and auto-refreshes using the `refresh_rate` returned by the API.

## Build

- `npm run electron:build`

## Automation (Thanks to R4wizard)

Workflow:
1. Create a bunch of commits as you work
  a. Push commits whenever, the build will run to give early indication of problems.
2. Prepare for release
  a. Update `package.json` with next version (recommended: [semver](https://semver.org/))
  b. Create a new tag with the same version number prefixed with `v`, for example `v1.0.0`
  c. Push the tag and watch the action run, this will automatically create a "draft" release.
3. Finalize the release
  a. Update the release description with a changelog.
  c. Publish the release
4. If something goes wrong, you can delete the tag and the draft release and try again. `electron-builder` suggests it is capable of automatically updating existing release but this has proved to not be true, ensure you delete the draft release if you're going to repush a tag.
