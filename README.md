# Android Smali Search

`jshook` plugin that runs a decode-and-search loop for quick smali/resource
triage.

## Tool

- `android_smali_search`
  - input: `apkPath`, `needle`, `maxMatches`
  - output: decoded output directory, scan size, and matching file/line hits
