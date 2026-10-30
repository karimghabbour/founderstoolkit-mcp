# founderstoolkit-mcp

An MCP server that lets an AI assistant look up the software tools listed on [founderstoolkit.org](https://founderstoolkit.org), a curated directory for solo founders and one-person businesses, and submit new tools to it. Every tool comes with its category, pricing, pros, cons and alternatives.

## How it works

The server runs on your own machine and talks to the AI client over stdio. It holds no data of its own. The first time one of its tools is called, it downloads what that tool needs from the site's public JSON API and keeps it in memory until the process stops:

- [`/api/tools.json`](https://founderstoolkit.org/api/tools.json) for the tools themselves
- [`/api/categories.json`](https://founderstoolkit.org/api/categories.json) for category names and the list of valid category slugs
- [`/api/submit.json`](https://founderstoolkit.org/api/submit.json) for the listing terms and the submission protocol
- [`/api/changes.json`](https://founderstoolkit.org/api/changes.json) for the log of verified changes to listings

Restart the server to pick up anything added to the site since it started.

`submit_tool` is the only tool that sends data anywhere. It posts the submission to the Formspree form named in `/api/submit.json`, which forwards it to the site's owner.

## Tools

| Tool | Input | What it returns |
|------|-------|-----------------|
| `search_tools` | `query` (optional keyword), `category` (optional slug), `limit` (optional, default 10) | Tools in the given category whose name, description, pros or cons contain the keyword, ignoring case. Each result has its category, description, pricing, pros, cons and a link to its page on the site. |
| `get_tool` | `name` | One tool in full: category, pricing (with the vendor's plans, the date they were checked and a best-for line when the directory has them), website, description, pros, cons, alternatives (with their pricing when they are in the directory) and a link to its page. |
| `compare_tools` | `tool1`, `tool2` | The pricing (with plans and best-for when available), pros and cons of both tools, and a link to `https://founderstoolkit.org/compare/{tool1}-vs-{tool2}` with the slugs in the order given. The site has comparison pages only for two tools in the same category, with the slugs in alphabetical order, so the link works only in that case. |
| `recommend_stack` | `business_type`: `saas`, `creator`, `ecommerce`, `freelancer` or `agency` | For each category on a fixed list for that business type (below), the first three tools the API lists in that category, with their pricing, and a link to the site's Stack Builder. |
| `list_categories` | none | Every category with its icon, name, tool count and description. |
| `get_listing_terms` | none | The terms for a free listing and for a featured listing (price, what it includes, payment link), the submission fields with their rules, the accepted category slugs and what happens after a submission. |
| `submit_tool` | `tool_name`, `website`, `maker`, `category`, `description`, `email`, `affiliated` (optional, default false) | Checks the input first: `maker` must not be empty, `website` must be a full http or https URL, `category` must be one of the slugs in `/api/categories.json`, `description` must be 40 to 600 characters and `email` must look like an email address. If anything fails, it lists every problem and sends nothing. Otherwise it posts the submission as JSON to the Formspree form and returns a confirmation with the featured listing terms and payment link, or the error text Formspree sent back. |
| `get_changes` | `slug` (optional), `limit` (optional, default 20) | Verified changes to listings, newest first: price changes, new owners, renames, shutdowns, ended free tiers, additions and removals. Each has its date, tool, kind, a one-sentence summary and its source. With `slug`, only the changes for that tool. |

`search_tools` adds "[Featured]" after the name of a featured tool, and `get_tool` adds a "Featured: yes" line.

`get_tool` and `compare_tools` find a tool by its slug or by its exact name, ignoring case. The slug is the name in lowercase with spaces turned into hyphens, so `lemonsqueezy` finds LemonSqueezy but `Lemon Squeezy` does not.

Category slugs for `search_tools` and `submit_tool`: ai-assistants, ai-coding, ai-models, analytics, auth, automation, backend, content, databases, design, email, hosting, marketing, payments, productivity, sales-crm, support, video-audio, website-builders.

Categories that `recommend_stack` covers for each business type:

| Business type | Categories |
|---------------|------------|
| saas | hosting, payments, auth, databases, analytics, email, support |
| creator | website-builders, email, payments, analytics, content, marketing |
| ecommerce | website-builders, payments, email, analytics, marketing, support |
| freelancer | website-builders, payments, email, productivity, analytics |
| agency | productivity, automation, analytics, email, support, design |

## Requirements

- Node.js 18 or later. The MCP SDK requires it, and the server uses Node's built-in `fetch`.
- Internet access to founderstoolkit.org.

## Setup

The package is on npm as `founderstoolkit-mcp`, so no download is needed: your MCP client starts it with `npx`.

For Claude Desktop, add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "founderstoolkit": {
      "command": "npx",
      "args": ["-y", "founderstoolkit-mcp"]
    }
  }
}
```

For Claude Code:

```bash
claude mcp add founderstoolkit -- npx -y founderstoolkit-mcp
```

For Cursor, Windsurf and other clients that take a command and arguments, use the same command, `npx`, with the arguments `-y founderstoolkit-mcp`.

To run it from a local copy instead, install the dependencies in this folder with `npm install` and register `node /absolute/path/to/index.mjs` as the command. On Windows, write the path with forward slashes.

## Troubleshooting

If every tool call answers `fetch failed` while https://founderstoolkit.org/api/tools.json opens fine in a browser, the network is probably inspecting encrypted traffic with a certificate that Node does not trust. Node 23.8 and later can use the operating system's certificates instead: add `"--use-system-ca"` before the path in `args`, or run `node --use-system-ca index.mjs`.

## Try it

Once the server is registered, ask your AI assistant things like:

- What's the best payment processor for a solo founder?
- Compare Stripe and Paddle.
- Recommend a complete tech stack for a SaaS product.
- What are the pros and cons of Vercel?
- Search for free hosting tools.
- What changed recently in the listings for AI coding tools?
- How do I get my tool listed on Founders Toolkit, and what does a featured listing cost?

## Using the data without the server

The server is a thin layer over the site's public JSON API, which anyone can call directly. The endpoints accept requests from any origin, so they also work from a browser.

- **All tools:** [`https://founderstoolkit.org/api/tools.json`](https://founderstoolkit.org/api/tools.json)
- **Categories:** [`https://founderstoolkit.org/api/categories.json`](https://founderstoolkit.org/api/categories.json)
- **Listing terms and submission protocol:** [`https://founderstoolkit.org/api/submit.json`](https://founderstoolkit.org/api/submit.json)
- **Change log:** [`https://founderstoolkit.org/api/changes.json`](https://founderstoolkit.org/api/changes.json)
- **Overview for AI agents:** [`https://founderstoolkit.org/llms.txt`](https://founderstoolkit.org/llms.txt)

```bash
curl https://founderstoolkit.org/api/tools.json | jq '.tools[:3]'
```

The API is rebuilt with the site. The `updated` field in `tools.json` gives the date of the last build.

## License

MIT
