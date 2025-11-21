import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
	API_URL?: string;
	ORGANIZATION?: string;
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "PortalJS MCP Server",
		version: "1.0.0",
	});

	async init() {
		const apiUrl = this.props?.env?.API_URL || "https://api.cloud.portaljs.com";
		const organization = this.props?.env?.ORGANIZATION;

		// Search tool
		this.server.tool(
			"search",
			"Search for datasets in PortalJS. Display the search results to the user in a readable format.",
			{
				query: z.string().describe("Search query to find datasets"),
				limit: z.number().optional().default(10).describe("Maximum number of results to return (default: 10)")
			},
			async ({ query, limit }) => {
				let endpoint = `${apiUrl}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=${limit}`;

				if (organization) {
					endpoint += `&fq=organization:${encodeURIComponent(organization)}`;
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
					url: `${apiUrl}/dataset/${item.name}`,
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
							organization: organization || "all",
							total_results: results.length,
							results
						}, null, 2)
					}]
				};
			}
		);

		// Fetch tool
		this.server.tool(
			"fetch",
			"Fetch and display detailed information about a specific dataset including its resources, metadata, and properties.",
			{
				id: z.string().describe("ID or name of the dataset to fetch")
			},
			async ({ id }) => {
				const endpoint = `${apiUrl}/api/3/action/package_show?id=${encodeURIComponent(id)}`;

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

				if (organization && result.organization?.name !== organization) {
					return {
						content: [{
							type: "text",
							text: `Error: Dataset '${id}' not found in organization '${organization}'`
						}]
					};
				}

				const dataset = {
					id: result.id,
					name: result.name,
					title: result.title || null,
					description: result.notes || null,
					url: `${apiUrl}/dataset/${result.name}`,
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
					const resourceEndpoint = `${apiUrl}/api/3/action/resource_show?id=${encodeURIComponent(resource_id)}`;
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

					if (organization) {
						const packageEndpoint = `${apiUrl}/api/3/action/package_show?id=${encodeURIComponent(resourceData.result.package_id)}`;
						const packageResponse = await fetch(packageEndpoint);
						const packageData = await packageResponse.json();

						if (packageData.success && packageData.result?.organization?.name !== organization) {
							return {
								content: [{
									type: "text",
									text: `Error: Resource not found in organization '${organization}'`
								}]
							};
						}
					}

					const resourceUrl = resourceData.result.url;
					const format = (resourceData.result.format || '').toLowerCase();

					try {
						const datastoreEndpoint = `${apiUrl}/api/3/action/datastore_search?resource_id=${encodeURIComponent(resource_id)}&limit=${maxLimit}`;
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
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		const pathParts = url.pathname.split('/').filter(p => p);
		let organization: string | undefined;
		let matchedPath: string | undefined;

		if (pathParts.length >= 2 && pathParts[0].startsWith('@') && pathParts[1] === 'sse') {
			organization = pathParts[0].substring(1); // Remove @ prefix
			matchedPath = '/sse';
		}
		else if (pathParts.length >= 3 && pathParts[0].startsWith('@') && pathParts[1] === 'sse' && pathParts[2] === 'message') {
			organization = pathParts[0].substring(1); // Remove @ prefix
			matchedPath = '/sse/message';
		}
		else if (pathParts.length >= 2 && pathParts[0].startsWith('@') && pathParts[1] === 'mcp') {
			organization = pathParts[0].substring(1); // Remove @ prefix
			matchedPath = '/mcp';
		}
		else if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			matchedPath = url.pathname;
		}
		else if (url.pathname === "/mcp") {
			matchedPath = "/mcp";
		}

		if (!matchedPath) {
			return new Response("Not found", { status: 404 });
		}

		const envWithOrg: Env = {
			...env,
			ORGANIZATION: organization
		};

		if (matchedPath === "/sse" || matchedPath === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, envWithOrg, ctx);
		}

		if (matchedPath === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, envWithOrg, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
