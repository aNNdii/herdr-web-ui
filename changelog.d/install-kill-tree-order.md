### Fixed
- The installer no longer takes a hung Rust PTY host for a working one when the host exits as soon
  as its children are killed: the time limit now stops the host before it kills what it started.
