import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Base URL constant for PortalJS API
 */
const BASE_URL = "https://api.cloud.portaljs.com";

/**
 * Extract organization name from URL pathname
 * Expected format: /@org-name/sse
 * Returns: @org-name (e.g., "@lcc")
 */
function extractOrgFromPath(pathname: string): string | null {
	if (pathname.startsWith('/@') && pathname.includes('/sse')) {
		const sseIndex = pathname.indexOf('/sse');
		return pathname.substring(1, sseIndex); // Extract @org-name
	}
	return null;
}

/**
 * Current API URL with organization scope
 *
 * IMPORTANT: This variable is set by the router (at bottom of file) BEFORE tools execute.
 * Router extracts org from request path and sets: current_api_url = BASE_URL/@org-name
 * Then tools read this variable to make org-scoped API calls.
 *
 * Example flow:
 * 1. Request comes to: /@lcc/sse
 * 2. Router extracts: @lcc
 * 3. Router sets: current_api_url = "https://api.cloud.portaljs.com/@lcc"
 * 4. Tools use: current_api_url for API calls
 */
let current_api_url = BASE_URL;

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "PortalJS MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Search tool
		this.server.tool(
			"search",
			"Search for datasets in PortalJS. Display the search results to the user in a readable format.",
			{
				query: z.string().describe("Search query to find datasets"),
				limit: z.number().optional().default(10).describe("Maximum number of results to return (default: 10)")
			},
			async ({ query, limit }) => {
				let endpoint = `${current_api_url}/api/3/action/package_search?rows=${limit}`;
				if (query && query !== "*") {
					endpoint = `${current_api_url}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=${limit}`;
				}

				const response = await fetch(endpoint, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"User-Agent": "MCP-PortalJS-Server/1.0"
					}
				});

				if (!response.ok) {
					return {
						content: [{
							type: "text",
							text: `Error: API returned ${response.status} ${response.statusText}`
						}]
					};
				}

				const data = await response.json();

				if (!data.success) {
					return {
						content: [{
							type: "text",
							text: `Error: ${JSON.stringify(data.error)}`
						}]
					};
				}

				const results = data.result && data.result.results ? data.result.results.map((item: any) => ({
					id: item.id,
					name: item.name,
					title: item.title,
					description: item.notes,
					url: `${current_api_url}/dataset/${item.name}`,
					organization: item.organization?.name,
					tags: item.tags?.map((tag: any) => tag.name),
					created: item.metadata_created,
					modified: item.metadata_modified,
				})) : [];

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							query,
							total_results: results.length,
							results
						}, null, 2)
					}]
				};
			}
		);

		// Get  tool
		this.server.tool(
			"get",
			"Get and display detailed information about a specific dataset including its resources, metadata, and properties.",
			{
				id: z.string().describe("ID or name of the dataset to get")
			},
			async ({ id }) => {
				const endpoint = `${current_api_url}/api/3/action/package_show?id=${encodeURIComponent(id)}`;

				const response = await fetch(endpoint, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"User-Agent": "MCP-PortalJS-Server/1.0"
					}
				});

				if (!response.ok) {
					return {
						content: [{
							type: "text",
							text: `Error: API returned ${response.status} ${response.statusText}`
						}]
					};
				}

				const data = await response.json();

				if (!data.success) {
					return {
						content: [{
							type: "text",
							text: `Error: ${JSON.stringify(data.error)}`
						}]
					};
				}

				if (!data.result) {
					return {
						content: [{
							type: "text",
							text: `Error: Missing result for request: ${id}`
						}]
					};
				}

				const result = data.result;

				if (!result.id) {
					return {
						content: [{
							type: "text",
							text: `Error: Dataset not found: ${id}`
						}]
					};
				}

				const dataset = {
					id: result.id,
					name: result.name,
					title: result.title || null,
					description: result.notes || null,
					url: `${current_api_url}/dataset/${result.name}`,
					organization: result.organization || null,
					tags: Array.isArray(result.tags) ? result.tags : [],
					resources: Array.isArray(result.resources) ? result.resources : [],
					groups: Array.isArray(result.groups) ? result.groups : [],
					created: result.metadata_created,
					modified: result.metadata_modified,
					license: result.license_title || null,
					maintainer: result.maintainer || null,
					author: result.author || null,
					state: result.state,
				};

				return {
					content: [{
						type: "text",
						text: JSON.stringify(dataset, null, 2)
					}]
				};
			}
		);

		// Preview data as table
		this.server.tool(
			"preview_data_table",
			"Preview and display dataset resource data in a table format. Use this when user wants to see, preview, or display data from a resource. IMPORTANT: Always display the returned markdown table directly in the chat response to the user.",
			{
				resource_id: z.string().describe("ID of the resource to preview"),
				limit: z.number().optional().default(10).describe("Number of rows to preview (default: 10, max: 100)")
			},
			async ({ resource_id, limit }) => {
				const maxLimit = Math.min(limit, 100);

				const parseCSV = (text: string, rowLimit: number): { fields: string[], records: any[] } => {
					const lines = text.split('\n').filter(line => line.trim());
					if (lines.length === 0) return { fields: [], records: [] };

					const parseLine = (line: string): string[] => {
						const result: string[] = [];
						let current = '';
						let inQuotes = false;

						for (let i = 0; i < line.length; i++) {
							const char = line[i];
							if (char === '"') {
								if (inQuotes && line[i + 1] === '"') {
									current += '"';
									i++;
								} else {
									inQuotes = !inQuotes;
								}
							} else if (char === ',' && !inQuotes) {
								result.push(current.trim());
								current = '';
							} else {
								current += char;
							}
						}
						result.push(current.trim());
						return result;
					};

					const fields = parseLine(lines[0]);
					const records = lines.slice(1, rowLimit + 1).map(line => {
						const values = parseLine(line);
						const record: any = {};
						fields.forEach((field, i) => {
							record[field] = values[i] || '';
						});
						return record;
					});

					return { fields, records };
				};

				const buildTable = (fields: string[], records: any[], metadata: { source: string, url?: string, total?: number, showing: number }) => {
					if (records.length === 0) return 'No data found in this resource.';

					const header = `| ${fields.join(' | ')} |`;
					const separator = `| ${fields.map(() => '---').join(' | ')} |`;
					const rows = records.map((record: any) => {
						const values = fields.map((field: string) => {
							const value = record[field];
							if (value === null || value === undefined) return '';
							return String(value).replace(/\|/g, '\\|');
						});
						return `| ${values.join(' | ')} |`;
					});

					const metaLines = [
						`**Source:** ${metadata.source}`,
						metadata.url ? `**Download URL:** [Download Resource](${metadata.url})` : null,
						metadata.total ? `**Total Records:** ${metadata.total}` : null,
						`**Showing:** ${metadata.showing} rows\n`
					].filter(Boolean);

					return [...metaLines, header, separator, ...rows].join('\n');
				};

				try {
					const resourceEndpoint = `${current_api_url}/api/3/action/resource_show?id=${encodeURIComponent(resource_id)}`;
					const resourceResponse = await fetch(resourceEndpoint);
					const resourceData = await resourceResponse.json();

					if (!resourceData.success || !resourceData.result?.url) {
						return {
							content: [{
								type: "text",
								text: `Error: Resource not found or has no accessible URL.`
							}]
						};
					}

					const resourceUrl = resourceData.result.url;
					const format = (resourceData.result.format || '').toLowerCase();

					try {
						const datastoreEndpoint = `${current_api_url}/api/3/action/datastore_search?resource_id=${encodeURIComponent(resource_id)}&limit=${maxLimit}`;
						const datastoreResponse = await fetch(datastoreEndpoint);
						const datastoreData = await datastoreResponse.json();

						if (datastoreData.success && datastoreData.result?.records) {
							const records = datastoreData.result.records;
							const fields = datastoreData.result.fields?.map((f: any) => f.id).filter((id: string) => id !== '_id') || [];

							const table = buildTable(fields, records, {
								source: 'DataStore',
								url: resourceUrl,
								total: datastoreData.result.total,
								showing: records.length
							});

							return { content: [{ type: "text", text: table }] };
						}
					} catch (datastoreError) {
						// DataStore failed, continue to fallback
					}

					const dataResponse = await fetch(resourceUrl);
					if (!dataResponse.ok) {
						return {
							content: [{
								type: "text",
								text: `Error: Failed to fetch resource data (HTTP ${dataResponse.status}).`
							}]
						};
					}

					const contentType = dataResponse.headers.get('content-type') || '';
					const rawData = await dataResponse.text();

					if (format === 'json' || contentType.includes('json')) {
						const parsed = JSON.parse(rawData);
						const array = Array.isArray(parsed) ? parsed : [parsed];
						const records = array.slice(0, maxLimit);
						const fields = records.length > 0 ? Object.keys(records[0]) : [];

						const table = buildTable(fields, records, {
							source: 'Direct fetch (JSON)',
							url: resourceUrl,
							showing: records.length
						});

						return { content: [{ type: "text", text: table }] };
					}

					if (format === 'csv' || contentType.includes('csv') || resourceUrl.endsWith('.csv')) {
						const { fields, records } = parseCSV(rawData, maxLimit);

						const table = buildTable(fields, records, {
							source: 'Direct fetch (CSV)',
							url: resourceUrl,
							showing: records.length
						});

						return { content: [{ type: "text", text: table }] };
					}

					return {
						content: [{
							type: "text",
							text: `Error: Unsupported format '${format}'. Only CSV and JSON are supported.`
						}]
					};

				} catch (error) {
					return {
						content: [{
							type: "text",
							text: `Error: Failed to preview data. ${error instanceof Error ? error.message : 'Unknown error'}`
						}]
					};
				}
			}
		);
	}
}

export default {
	fetch(request: Request, env: any, ctx: ExecutionContext) {
		const url = new URL(request.url);
		const pathname = url.pathname;

		// Extract organization from path
		const orgPath = extractOrgFromPath(pathname);

		if (orgPath) {
			// Set org-scoped API URL for tools to use
			current_api_url = `${BASE_URL}/${orgPath}`;
			return MyMCP.serveSSE(`/${orgPath}/sse`).fetch(request, env, ctx);
		}

		return new Response("Not found - Organization scope required. Use /@org-name/sse", { status: 404 });
	},
};
