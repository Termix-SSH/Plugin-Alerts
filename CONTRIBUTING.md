# Contributing to Alerts

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Docs

The docs for this plugin are in [docs/](docs/) and are published at https://docs.termix.site/plugins/alerts. Settings, permissions, services, environment variables and the API reference are made from `manifest.json` and the `@openapi` comments in the code, so keep those up to date instead of writing them by hand. See [writing docs](https://docs.termix.site/develop/docs).

## Announcements

Termix announcements are Markdown files in [announcements/](announcements/). The plugin reads `announcements.json` from `main`, so an announcement goes out once both are on `main`.

```bash
npm run announce -- "Termix 26.10 is out"   # new file in announcements/, dated now
npm run announce:build                      # check every file and write announcements.json
npm run announce:check                      # what CI runs
```

Committing a file in `announcements/` rebuilds `announcements.json` for you. The new file explains each field:

| Field      | Default    |                                                                                     |
| ---------- | ---------- | ----------------------------------------------------------------------------------- |
| `title`    |            | Required.                                                                           |
| `id`       | file name  | The part after the date. Never reuse one, it is how a user's copy is tracked.       |
| `severity` | `info`     | `info`, `success`, `warning` or `critical`.                                         |
| `date`     |            | When it goes live. A future date waits until then.                                  |
| `expires`  | never      | A date, or a time after `date` like `12h`, `7d` or `2w`. It stays in inboxes after. |
| `newUsers` | `false`    | Users who sign up after `date` only get it when this is `true`.                     |
| `audience` | `everyone` | `everyone` or `admins`.                                                             |
| `display`  | `inbox`    | `popup` also shows it as a card on screen when it arrives.                          |
| `actions`  | none       | Up to 4 buttons, each a `label` with a `url` or a Termix `tab` id.                  |

The body under the frontmatter is Markdown: paragraphs, headings, lists, bold, italic, inline code and links.
