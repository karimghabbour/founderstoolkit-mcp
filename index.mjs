#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DATA_URL = "https://founderstoolkit.org/api/tools.json";
const CATEGORIES_URL = "https://founderstoolkit.org/api/categories.json";
const SUBMIT_URL = "https://founderstoolkit.org/api/submit.json";
const CHANGES_URL = "https://founderstoolkit.org/api/changes.json";

let toolsCache = null;
let categoriesCache = null;
let protocolCache = null;
let changesCache = null;

async function loadTools() {
  if (toolsCache) return toolsCache;
  const res = await fetch(DATA_URL);
  const data = await res.json();
  toolsCache = data.tools;
  return toolsCache;
}

async function loadCategories() {
  if (categoriesCache) return categoriesCache;
  const res = await fetch(CATEGORIES_URL);
  const data = await res.json();
  categoriesCache = data.categories;
  return categoriesCache;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.json();
}

// The submission protocol and listing terms, as published at /api/submit.json.
async function loadProtocol() {
  if (protocolCache) return protocolCache;
  protocolCache = await fetchJson(SUBMIT_URL);
  return protocolCache;
}

async function loadChanges() {
  if (changesCache) return changesCache;
  const data = await fetchJson(CHANGES_URL);
  changesCache = data.changes;
  return changesCache;
}

function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}

function featuredTermsText(featured, aiVisibility) {
  const flat = `Featured listing: ${featured.price} ${featured.currency} a ${featured.interval}, for a tool that is already listed.
${featured.benefits.map((b) => `- ${b}`).join("\n")}
Payment link: ${featured.paymentLink}`;
  if (!aiVisibility) return flat;
  return `${flat}

${aiVisibility.terms}
How to start: ${aiVisibility.howToStart}`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns a list of problems; an empty list means the submission can be sent.
function validateSubmission({ tool_name, website, maker, category, description, email }, categorySlugs, limits) {
  const problems = [];
  if (!tool_name.trim()) problems.push("tool_name is empty.");
  if (!maker || !maker.trim()) problems.push("maker is empty; give the company or person named on the tool's own website.");

  let url = null;
  try {
    url = new URL(website.trim());
  } catch {
    // reported below
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
    problems.push(`website "${website}" is not a full http or https URL.`);
  }

  if (!categorySlugs.includes(category.trim())) {
    problems.push(`category "${category}" is not one of: ${categorySlugs.join(", ")}.`);
  }

  const length = description.trim().length;
  if (length < limits.min || length > limits.max) {
    problems.push(`description is ${length} characters long; it must be ${limits.min} to ${limits.max}.`);
  }

  if (!EMAIL_PATTERN.test(email.trim())) problems.push(`email "${email}" is not a valid address.`);

  return problems;
}

const server = new McpServer({
  name: "founderstoolkit",
  version: "1.0.0",
});

// Tool 1: Search tools by keyword or category
server.tool(
  "search_tools",
  "Search solo founder tools by keyword, category, or pricing. Returns matching tools with pros, cons, and pricing.",
  {
    query: z.string().optional().describe("Keyword to search in name/description"),
    category: z.string().optional().describe("Filter by category slug (e.g. 'ai-coding', 'payments', 'hosting', 'analytics', 'auth', 'databases', 'email', 'automation', 'backend', 'content', 'design', 'marketing', 'productivity', 'support', 'website-builders')"),
    limit: z.number().optional().default(10).describe("Max results to return"),
  },
  async ({ query, category, limit }) => {
    const tools = await loadTools();
    let results = tools;

    if (category) {
      results = results.filter((t) => t.category === category);
    }
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.pros.some((p) => p.toLowerCase().includes(q)) ||
          t.cons.some((c) => c.toLowerCase().includes(q))
      );
    }

    results = results.slice(0, limit || 10);

    const text = results.length
      ? results
          .map(
            (t) =>
              `**${t.name}** (${t.categoryName})${t.featured ? " [Featured]" : ""}\n${t.description}\nPricing: ${t.pricing}\nPros: ${t.pros.join("; ")}\nCons: ${t.cons.join("; ")}\nMore: ${t.url}`
          )
          .join("\n\n---\n\n")
      : "No tools found matching your criteria.";

    return { content: [{ type: "text", text }] };
  }
);

// The vendor's plans as indented lines, with the date they were checked, when the API has them.
function plansText(tool, indent = "") {
  if (!tool.plans || tool.plans.length === 0) return "";
  const lines = tool.plans.map((p) => `${indent}- ${p.name}: ${p.price}${p.note ? ` (${p.note})` : ""}`);
  const checked = tool.pricingVerified ? `\n${indent}Prices checked ${tool.pricingVerified}${tool.pricingSource ? ` at ${tool.pricingSource}` : ""}` : "";
  return `\n${indent}Plans:\n${lines.join("\n")}${checked}`;
}

// Tool 2: Get detailed info about a specific tool
server.tool(
  "get_tool",
  "Get detailed information about a specific tool including pros, cons, pricing, and alternatives.",
  {
    name: z.string().describe("Tool name or slug (e.g. 'stripe', 'cursor', 'vercel')"),
  },
  async ({ name }) => {
    const tools = await loadTools();
    const q = name.toLowerCase().replace(/\s+/g, "-");
    const tool = tools.find(
      (t) => t.slug === q || t.name.toLowerCase() === name.toLowerCase()
    );

    if (!tool) {
      return { content: [{ type: "text", text: `Tool "${name}" not found. Try search_tools to find it.` }] };
    }

    const alts = tool.alternatives.length
      ? tool.alternatives
          .map((slug) => {
            const alt = tools.find((t) => t.slug === slug);
            return alt ? `${alt.name} (${alt.pricing})` : slug;
          })
          .join(", ")
      : "None listed";

    const text = `# ${tool.name}

**Category:** ${tool.categoryName}${tool.featured ? "\n**Featured:** yes" : ""}
**Pricing:** ${tool.pricing}${plansText(tool)}${tool.bestFor ? `\n**Best for:** ${tool.bestFor}` : ""}
**Website:** ${tool.website}

${tool.description}

**Pros:**
${tool.pros.map((p) => `- ${p}`).join("\n")}

**Cons:**
${tool.cons.map((c) => `- ${c}`).join("\n")}

**Alternatives:** ${alts}

Full review: ${tool.url}`;

    return { content: [{ type: "text", text }] };
  }
);

// Tool 3: Compare two tools
server.tool(
  "compare_tools",
  "Compare two tools side-by-side with pros, cons, and pricing differences.",
  {
    tool1: z.string().describe("First tool name or slug"),
    tool2: z.string().describe("Second tool name or slug"),
  },
  async ({ tool1, tool2 }) => {
    const tools = await loadTools();
    const find = (name) => {
      const q = name.toLowerCase().replace(/\s+/g, "-");
      return tools.find(
        (t) => t.slug === q || t.name.toLowerCase() === name.toLowerCase()
      );
    };

    const a = find(tool1);
    const b = find(tool2);

    if (!a || !b) {
      const missing = [!a && tool1, !b && tool2].filter(Boolean).join(", ");
      return { content: [{ type: "text", text: `Tool(s) not found: ${missing}` }] };
    }

    if (a.category !== b.category) {
      return { content: [{ type: "text", text: `${a.name} (${a.categoryName}) and ${b.name} (${b.categoryName}) are in different categories, so there is no comparison page for them. Compare each with tools in its own category instead.` }] };
    }

    const text = `# ${a.name} vs ${b.name}

## ${a.name}
- **Pricing:** ${a.pricing}${plansText(a, "  ")}${a.bestFor ? `\n- **Best for:** ${a.bestFor}` : ""}
- **Pros:** ${a.pros.join("; ")}
- **Cons:** ${a.cons.join("; ")}

## ${b.name}
- **Pricing:** ${b.pricing}${plansText(b, "  ")}${b.bestFor ? `\n- **Best for:** ${b.bestFor}` : ""}
- **Pros:** ${b.pros.join("; ")}
- **Cons:** ${b.cons.join("; ")}

Full comparison: https://founderstoolkit.org/compare/${[a.slug, b.slug].sort().join("-vs-")}`;

    return { content: [{ type: "text", text }] };
  }
);

// Tool 4: Recommend a stack for a business type
server.tool(
  "recommend_stack",
  "Recommend a complete tool stack for a solo founder based on their business type.",
  {
    business_type: z
      .enum(["saas", "creator", "ecommerce", "freelancer", "agency"])
      .describe("Type of solo business"),
  },
  async ({ business_type }) => {
    const tools = await loadTools();
    const categories = await loadCategories();

    const needs = {
      saas: ["hosting", "payments", "auth", "databases", "analytics", "email", "support"],
      creator: ["website-builders", "email", "payments", "analytics", "content", "marketing"],
      ecommerce: ["website-builders", "payments", "email", "analytics", "marketing", "support"],
      freelancer: ["website-builders", "payments", "email", "productivity", "analytics"],
      agency: ["productivity", "automation", "analytics", "email", "support", "design"],
    };

    const relevantCategories = needs[business_type] || needs.saas;

    const recommendations = relevantCategories.map((catSlug) => {
      const catTools = tools.filter((t) => t.category === catSlug);
      const cat = categories.find((c) => c.slug === catSlug);
      const top = catTools.slice(0, 3);
      return {
        category: cat?.name || catSlug,
        tools: top.map((t) => `${t.name} (${t.pricing})`),
      };
    });

    const text = `# Recommended Stack: ${business_type.charAt(0).toUpperCase() + business_type.slice(1)}

${recommendations.map((r) => `**${r.category}:** ${r.tools.join(" | ")}`).join("\n\n")}

Explore more: https://founderstoolkit.org/stacks/`;

    return { content: [{ type: "text", text }] };
  }
);

// Tool 5: List all categories
server.tool(
  "list_categories",
  "List all tool categories with tool counts.",
  {},
  async () => {
    const categories = await loadCategories();
    const text = categories
      .map((c) => `${c.icon} **${c.name}** — ${c.toolCount} tools\n  ${c.description}`)
      .join("\n\n");

    return { content: [{ type: "text", text }] };
  }
);

// Tool 6: Listing terms and submission protocol
server.tool(
  "get_listing_terms",
  "Get the terms for listing a tool on founderstoolkit.org (free listing, the flat-price featured listing with its payment link, and the AI visibility listing billed per verified AI read) and the protocol for submitting one.",
  {},
  async () => {
    let protocol;
    try {
      protocol = await loadProtocol();
    } catch (err) {
      return errorResult(`Could not load the listing terms from ${SUBMIT_URL}: ${err.message}`);
    }

    const fields = Object.entries(protocol.fields)
      .map(([name, f]) => `- ${name} (${f.type}, ${f.required ? "required" : "optional"}): ${f.description}`)
      .join("\n");
    const headers = Object.entries(protocol.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join(", ");
    const categories = protocol.categories.map((c) => `${c.slug} (${c.name})`).join(", ");

    const text = `# Listing terms

Free listing: ${protocol.terms.free}

${featuredTermsText(protocol.terms.featured, protocol.terms.aiVisibility)}

# How to submit

Use the submit_tool tool, or send an HTTP ${protocol.method} request to ${protocol.endpoint} with the headers ${headers} and a JSON body with these fields:
${fields}

Category slugs: ${categories}

After submission: ${protocol.afterSubmission}

Contact: ${protocol.contact}`;

    return { content: [{ type: "text", text }] };
  }
);

// Tool 7: Submit a tool for listing
server.tool(
  "submit_tool",
  "Submit a software tool for listing on founderstoolkit.org. Listing is free; the entry is checked against the tool's own website before it is published. Call get_listing_terms first to see the terms and the accepted categories.",
  {
    tool_name: z.string().describe("The tool's name"),
    website: z.string().describe("The tool's own website, as a full http or https URL"),
    maker: z.string().describe("The company or person that makes the tool, exactly as named on the tool's own website (about page, footer, terms or privacy policy)"),
    category: z.string().describe("One category slug, as listed by list_categories or get_listing_terms"),
    description: z.string().describe("What the tool does and why it suits a one-person company, 40 to 600 characters"),
    email: z.string().describe("The address that receives the reply"),
    affiliated: z.boolean().optional().default(false).describe("true if the sender works for, owns or is paid by the tool's maker"),
  },
  async ({ tool_name, website, maker, category, description, email, affiliated }) => {
    let categories;
    let protocol;
    try {
      [categories, protocol] = await Promise.all([loadCategories(), loadProtocol()]);
    } catch (err) {
      return errorResult(`The submission was not sent, because the categories and terms could not be loaded from founderstoolkit.org: ${err.message}`);
    }

    const limits = {
      min: protocol.fields?.description?.minLength ?? 40,
      max: protocol.fields?.description?.maxLength ?? 600,
    };
    const problems = validateSubmission(
      { tool_name, website, maker, category, description, email },
      categories.map((c) => c.slug),
      limits
    );
    if (problems.length) {
      return errorResult(`The submission was not sent, because:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    }

    const body = {
      tool_name: tool_name.trim(),
      website: website.trim(),
      maker: maker.trim(),
      category: category.trim(),
      description: description.trim(),
      email: email.trim(),
      affiliated: Boolean(affiliated),
    };

    let res;
    try {
      res = await fetch(protocol.endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return errorResult(`The submission could not reach ${protocol.endpoint}: ${err.message}`);
    }

    let reply = null;
    try {
      reply = await res.json();
    } catch {
      // a reply that is not JSON is reported by its status below
    }

    const errorText =
      (Array.isArray(reply?.errors) && reply.errors.map((e) => e.message).join("; ")) ||
      (typeof reply?.error === "string" && reply.error) ||
      (!res.ok && `HTTP ${res.status}`) ||
      (!reply && "the reply was not JSON");
    if (errorText) {
      return errorResult(`The submission was not accepted. The form service answered: ${errorText}`);
    }

    const text = `${body.tool_name} was submitted to Founders Toolkit.

What happens next: ${protocol.afterSubmission}

${featuredTermsText(protocol.terms.featured, protocol.terms.aiVisibility)}`;

    return { content: [{ type: "text", text }] };
  }
);

// Tool 8: Recent verified changes to listings
server.tool(
  "get_changes",
  "Get recent verified changes to listings on founderstoolkit.org: price changes, new owners, renames, shutdowns, ended free tiers, additions and removals, newest first, each with its source.",
  {
    slug: z.string().optional().describe("Only return changes for this tool slug (e.g. 'cody', 'planetscale')"),
    limit: z.number().optional().default(20).describe("Max changes to return"),
  },
  async ({ slug, limit }) => {
    let changes;
    try {
      changes = await loadChanges();
    } catch (err) {
      return errorResult(`Could not load the change log from ${CHANGES_URL}: ${err.message}`);
    }

    let results = changes;
    if (slug) {
      const q = slug.toLowerCase().trim().replace(/\s+/g, "-");
      results = results.filter((c) => c.slug === q);
    }
    results = results.slice(0, limit || 20);

    const text = results.length
      ? results
          .map((c) => `**${c.name}** (${c.slug}), ${c.kind}, ${c.date}\n${c.summary}\nSource: ${c.source}`)
          .join("\n\n")
      : slug
        ? `No changes recorded for "${slug}".`
        : "No changes recorded yet.";

    return { content: [{ type: "text", text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
