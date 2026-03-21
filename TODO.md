# TODO

- [ ] Monitor files changes (compile_commands.json, project.json, args.gn)
- [ ] Multi-workspace support. Settings, trees, etc...
- [x] Load args from valhalla? `args.gn` file or
  `./gn/gnb_config_parser.py --config ./configs/zodiac-entone5xx-sfw-prd.yaml --args`
- [ ] Problem matcher for 'gnb' tasks (should be relative to out.XXX directory)
- [ ] Open non-valhalla projects
- [ ] Show Valhalla files. This requires some way to extract deps info from ninja.
  - https://www.npmjs.com/package/ninja-binaries
  - https://www.npmjs.com/package/ninja-runtime
  - https://www.npmjs.com/package/ninja-build
