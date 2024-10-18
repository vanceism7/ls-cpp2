# LS-Cpp2

This is a proof-of-concept language server for [cpp2]. We may end up writing the language server in
a different language, but since I've never done this before, starting here is the easiest way to
begin.

This language server relies on my personal cppfront branch which you can find at
https://github.com/vanceism7/cppfront (although hopefully I can get the changes merged upstream
quickly if they're useful)

[cpp2]: https://hsutter.github.io/cppfront/

## Features

Currently this language server has the following features:

- Error Diagnostics
- Auto Completion (somewhat, it's a little clunky still)
- Go to Definition

## Contributing

I haven't given this much thought yet, but here's probably what you need to do...:

### Setup

#### Get cppfront with diagnostics

You'll need to build my version of cppfront to get the diagnostics currently (until a PR is
officially pushed in). Just pull it from my cppfront repo and follow the build instructions like
usual (Found at:
https://hsutter.github.io/cppfront/welcome/overview/#how-do-i-get-and-build-cppfront)

Once you've got it built, make sure its in your path too. Setting the path in the plugin config
isn't done yet.

#### Run the plugin

You can use the `Run and Debug` in vscode to run the plugin for testing.

#### Running tests

There aren't many, but you can run them with `npm test`

### Code Layout

The relevant code is in `project-root/server/src/`

- `server.ts`:  
  This is "main" file where the entire project is ran from. All of the lsp functionality stems from
  this file. I've started to separate things out into their own modules, but its still rough.

- `diagnostics.ts`:  
  This file contains all the main definitions we need for working with the diagnostics output from
  cppfront. It has the type definitions and the functions that let us query the data

- `definition.ts`:  
  Implements the go-to defintiion functionality. I think ideally, I want to separate every piece of
  lsp functionality into its own module so we can get `server.ts` really clean looking at the end

- `util.ts`:  
  This file contains very general helper functions that are probably used by many other modules

- Test Files:
  For each functionality implementation file (like `definition.ts`), I want to make a `*.test.ts`
  equivalent to we have an easy way to test things out each piece of functionality if needed.

## Other notes:

I left the original readme from the tutorial below, since a lot of it is still relevant

# LSP Example

Heavily documented sample code for https://code.visualstudio.com/api/language-extensions/language-server-extension-guide

## Functionality

This Language Server works for plain text file. It has the following language features:

- Completions
- Diagnostics regenerated on each file change or configuration change

It also includes an End-to-End test.

## Structure

```
.
├── client // Language Client
│   ├── src
│   │   ├── test // End to End tests for Language Client / Server
│   │   └── extension.ts // Language Client entry point
├── package.json // The extension manifest.
└── server // Language Server
    └── src
        └── server.ts // Language Server entry point
```

## Running the Sample

- Run `npm install` in this folder. This installs all necessary npm modules in both the client and server folder
- Open VS Code on this folder.
- Press Ctrl+Shift+B to start compiling the client and server in [watch mode](https://code.visualstudio.com/docs/editor/tasks#:~:text=The%20first%20entry%20executes,the%20HelloWorld.js%20file.).
- Switch to the Run and Debug View in the Sidebar (Ctrl+Shift+D).
- Select `Launch Client` from the drop down (if it is not already).
- Press ▷ to run the launch config (F5).
- In the [Extension Development Host](https://code.visualstudio.com/api/get-started/your-first-extension#:~:text=Then%2C%20inside%20the%20editor%2C%20press%20F5.%20This%20will%20compile%20and%20run%20the%20extension%20in%20a%20new%20Extension%20Development%20Host%20window.) instance of VSCode, open a document in 'plain text' language mode.
  - Type `j` or `t` to see `Javascript` and `TypeScript` completion.
  - Enter text content such as `AAA aaa BBB`. The extension will emit diagnostics for all words in all-uppercase.
