# Building a Remote MCP Server on Cloudflare (Without Auth)

This example allows you to deploy a remote MCP server that doesn't require authentication on Cloudflare Workers.

## Get started:

[![Deploy to Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-authless)

This will deploy your MCP server to a URL like: `remote-mcp-server-authless.<your-account>.workers.dev/sse`

Alternatively, you can use the command line below to get the remote MCP Server created on your local machine:
```bash
npm create cloudflare@latest -- my-mcp-server --template=cloudflare/ai/demos/remote-mcp-authless
```

## Customizing your MCP Server

To add your own [tools](https://developers.cloudflare.com/agents/model-context-protocol/tools/) to the MCP server, define each tool inside the `init()` method of `src/index.ts` using `this.server.tool(...)`.

## Connect to Cloudflare AI Playground

You can connect to your MCP server from the Cloudflare AI Playground, which is a remote MCP client:

1. Go to https://playground.ai.cloudflare.com/
2. Enter your deployed MCP server URL (`remote-mcp-server-authless.<your-account>.workers.dev/sse`)
3. You can now use your MCP tools directly from the playground!

## Connect Claude Desktop to your MCP server

You can also connect to your remote MCP server from local MCP clients, by using the [mcp-remote proxy](https://www.npmjs.com/package/mcp-remote).

To connect to your MCP server from Claude Desktop, follow [Anthropic's Quickstart](https://modelcontextprotocol.io/quickstart/user) and within Claude Desktop go to Settings > Developer > Edit Config.

Update with this configuration:

```json
{
  "mcpServers": {
    "calculator": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/sse"  // or remote-mcp-server-authless.your-account.workers.dev/sse
      ]
    }
  }
}
```

Restart Claude and you should see the tools become available.

## Available Tools

This PortalJS MCP Server provides multiple tools for working with datasets, organizations, and resources. Here's how to use them with Claude or ChatGPT:

### 🔑 Authentication

**Set your API key** (required for write operations)
- Say: "My PortalJS API key is `your_key_here`"
- This will call the `set_api_key` tool

### 🔍 Discovery Tools (No Auth Required)

**Search for datasets**
- Say: "Search for datasets about climate change"
- This will call the `search` tool

**Get detailed dataset information**
- Say: "Show me details about the dataset named 'world-happiness-2020'"
- This will call the `fetch` tool

**Get quick dataset statistics**
- Say: "What are the stats for dataset 'world-happiness-2020'?"
- This will call the `get_dataset_stats` tool (shows size, formats, resource count, etc.)

**Preview data structure**
- Say: "Preview the first 10 rows of resource ID `abc123`"
- This will call the `preview_resource` tool (shows column names, types, and sample data)

**Find related datasets**
- Say: "Find datasets related to 'world-happiness-2020'"
- This will call the `get_related_datasets` tool (discovers similar datasets by tags or organization)

**Compare multiple datasets**
- Say: "Compare these datasets: 'dataset-a', 'dataset-b', 'dataset-c'"
- This will call the `compare_datasets` tool (side-by-side metadata comparison)

**Get organization information**
- Say: "Tell me about the organization 'my-org-name'"
- This will call the `get_organization_details` tool (shows credibility info like creation date, dataset count)

### ✏️ Write Operations (Requires Authentication)

**List your organizations**
- Say: "Show me my organizations"
- This will call the `list_organizations` tool (needed to get organization IDs for creating datasets)

**Create a new dataset**
- Say: "Create a dataset called 'my-new-dataset' with title 'My Dataset' in organization `org-id`"
- This will call the `create_dataset` tool

**Add a resource to a dataset**
- Say: "Add a CSV resource from URL `https://example.com/data.csv` to dataset 'my-dataset'"
- This will call the `create_resource` tool

**Update dataset metadata**
- Say: "Update dataset 'my-dataset' with new description 'Updated info' and tags 'data, analysis'"
- This will call the `update_dataset` tool

**Update organization details**
- Say: "Update organization 'my-org' with new description 'New description'"
- This will call the `update_organization` tool

### 💡 Tips

- Most discovery tools work without authentication
- Write operations require setting your API key first
- Dataset names must be lowercase with hyphens (e.g., 'my-dataset-name')
- When creating datasets, use `list_organizations` first to get your organization ID
- All tools return JSON-formatted responses for easy parsing.