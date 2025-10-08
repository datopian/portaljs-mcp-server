import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
	API_URL?: string;
}

interface State {
	apiKey?: string;
	apiUrl?: string;
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env, State> {
	server = new McpServer({
		name: "PortalJS MCP Server",
		version: "1.0.0",
	});

	initialState: State = {};

	getApiUrl(): string {
		return this.state.apiUrl || this.props?.env?.API_URL || "https://api.cloud.portaljs.com";
	}

	async init() {

		// Set API key tool - users can authenticate at runtime saying "Set my API key: abc_123qwer...."
		this.server.tool(
			"set_api_key",
			"Set your PortalJS API key for this session. Required for creating/updating datasets.",
			{
				api_key: z.string().describe("Your PortalJS API key from your account settings"),
				api_url: z.string().optional().describe("Your PortalJS instance URL (optional, defaults to https://api.cloud.portaljs.com)")
			},
			async ({ api_key, api_url }) => {
				await this.setState({
					apiKey: api_key,
					apiUrl: api_url || this.getApiUrl()
				});

				return {
					content: [{
						type: "text",
						text: `✅ API key configured successfully!\n\nYou can now:\n- Create datasets\n- Update datasets\n- Upload resources\n\n⚠️ Your API key is stored only for this chat session and will be cleared when you close this conversation.`
					}]
				};
			}
		);

		// Search tool
		this.server.tool(
			"search",
			"Search for datasets in PortalJS",
			{
				query: z.string().describe("Search query to find datasets"),
				limit: z.number().optional().default(10).describe("Maximum number of results to return (default: 10)")
			},
			async ({ query, limit }) => {
				const apiUrl = this.getApiUrl();
				const endpoint = `${apiUrl}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=${limit}`;

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
			"Fetch detailed information about a specific dataset",
			{
				id: z.string().describe("ID or name of the dataset to fetch")
			},
			async ({ id }) => {
				const apiUrl = this.getApiUrl();
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

		// Create dataset tool
		this.server.tool(
			"create_dataset",
			"Create a new dataset in PortalJS. Requires authentication via set_api_key tool first.",
			{
				name: z.string().describe("Unique identifier for the dataset (lowercase, no spaces, use hyphens)"),
				title: z.string().describe("Human-readable title for the dataset"),
				notes: z.string().optional().describe("Description of the dataset"),
				owner_org: z.string().optional().describe("Organization ID that owns this dataset"),
				tags: z.array(z.string()).optional().describe("List of tags for categorization"),
				private: z.boolean().optional().default(false).describe("Whether the dataset is private (default: false)")
			},
			async ({ name, title, notes, owner_org, tags, private: isPrivate }) => {
				const apiUrl = this.getApiUrl();

				if (!this.state.apiKey) {
					return {
						content: [{
							type: "text",
							text: `Authentication required.\n\nPlease set your API key first by sharing it with me, for example:\n"My PortalJS API key is YOUR_KEY_HERE"\n\nOr use the set_api_key tool directly.`
						}]
					};
				}

				const endpoint = `${apiUrl}/api/3/action/package_create`;

				const requestBody: any = {
					name,
					title,
					private: isPrivate
				};

				if (notes) requestBody.notes = notes;
				if (owner_org) requestBody.owner_org = owner_org;
				if (tags && tags.length > 0) {
					requestBody.tags = tags.map(tag => ({ name: tag }));
				}

				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": this.state.apiKey,
						"User-Agent": "MCP-PortalJS-Server/1.0"
					},
					body: JSON.stringify(requestBody)
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
					const errorMsg = data.error?.message || JSON.stringify(data.error);
					let helpText = "";

					if (errorMsg.includes("owner_org") || errorMsg.includes("organization")) {
						helpText = "\n\n💡 Tip: This error often means you need to specify an organization. Try adding the owner_org parameter with your organization's ID.";
					} else if (errorMsg.includes("That URL is already in use") || errorMsg.includes("already exists")) {
						helpText = "\n\n💡 Tip: A dataset with this name already exists. Try using a different name.";
					}

					return {
						content: [{
							type: "text",
							text: `❌ Error creating dataset:\n${errorMsg}${helpText}`
						}]
					};
				}

				const result = data.result;

				return {
					content: [{
						type: "text",
						text: `✅ Dataset created successfully!\n\nID: ${result.id}\nName: ${result.name}\nTitle: ${result.title}\nURL: ${apiUrl}/dataset/${result.name}\n\nYou can now add resources (data files) to this dataset.`
					}]
				};
			}
		);

		// List organizations tool
		this.server.tool(
			"list_organizations",
			"List organizations that you belong to. Use this to find organization IDs for creating datasets.",
			{},
			async () => {
				const apiUrl = this.getApiUrl();

				if (!this.state.apiKey) {
					return {
						content: [{
							type: "text",
							text: `Authentication required.\n\nPlease set your API key first.`
						}]
					};
				}

				const endpoint = `${apiUrl}/api/3/action/organization_list_for_user`;

				const response = await fetch(endpoint, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"Authorization": this.state.apiKey,
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

				if (!data.success || !data.result) {
					return {
						content: [{
							type: "text",
							text: `Error: ${JSON.stringify(data.error)}`
						}]
					};
				}

				const orgs = data.result.map((org: any) => ({
					id: org.id,
					name: org.name,
					title: org.title || org.display_name,
					description: org.description
				}));

				return {
					content: [{
						type: "text",
						text: JSON.stringify({ organizations: orgs }, null, 2)
					}]
				};
			}
		);

		// Create resource tool
		this.server.tool(
			"create_resource",
			"Add a resource (file or URL) to an existing dataset. Resources can be CSV, JSON, Excel files, or external URLs.",
			{
				package_id: z.string().describe("ID or name of the dataset to add the resource to"),
				name: z.string().describe("Name of the resource (e.g., 'data.csv', 'API endpoint')"),
				url: z.string().describe("URL to the resource (can be external URL or data URL)"),
				description: z.string().optional().describe("Description of the resource"),
				format: z.string().optional().describe("Format of the resource (e.g., CSV, JSON, XLSX)")
			},
			async ({ package_id, name, url, description, format }) => {
				const apiUrl = this.getApiUrl();

				if (!this.state.apiKey) {
					return {
						content: [{
							type: "text",
							text: `Authentication required.\n\nPlease set your API key first.`
						}]
					};
				}

				const endpoint = `${apiUrl}/api/3/action/resource_create`;

				const requestBody: any = {
					package_id,
					name,
					url
				};

				if (description) requestBody.description = description;
				if (format) requestBody.format = format;

				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": this.state.apiKey,
						"User-Agent": "MCP-PortalJS-Server/1.0"
					},
					body: JSON.stringify(requestBody)
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
							text: `❌ Error creating resource:\n${JSON.stringify(data.error)}`
						}]
					};
				}

				const result = data.result;

				return {
					content: [{
						type: "text",
						text: `✅ Resource added successfully!\n\nID: ${result.id}\nName: ${result.name}\nFormat: ${result.format || 'N/A'}\nURL: ${result.url}`
					}]
				};
			}
		);

		// Update dataset tool
		this.server.tool(
			"update_dataset",
			"Update an existing dataset's metadata (title, description, tags, etc.)",
			{
				id: z.string().describe("ID or name of the dataset to update"),
				title: z.string().optional().describe("New title for the dataset"),
				notes: z.string().optional().describe("New description for the dataset"),
				tags: z.array(z.string()).optional().describe("New list of tags (replaces existing tags)"),
				private: z.boolean().optional().describe("Change visibility (true = private, false = public)")
			},
			async ({ id, title, notes, tags, private: isPrivate }) => {
				const apiUrl = this.getApiUrl();

				if (!this.state.apiKey) {
					return {
						content: [{
							type: "text",
							text: `Authentication required.\n\nPlease set your API key first.`
						}]
					};
				}

				const endpoint = `${apiUrl}/api/3/action/package_patch`;

				const requestBody: any = { id };

				if (title) requestBody.title = title;
				if (notes) requestBody.notes = notes;
				if (tags) requestBody.tags = tags.map(tag => ({ name: tag }));
				if (isPrivate !== undefined) requestBody.private = isPrivate;

				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": this.state.apiKey,
						"User-Agent": "MCP-PortalJS-Server/1.0"
					},
					body: JSON.stringify(requestBody)
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
							text: `❌ Error updating dataset:\n${JSON.stringify(data.error)}`
						}]
					};
				}

				const result = data.result;

				return {
					content: [{
						type: "text",
						text: `✅ Dataset updated successfully!\n\nName: ${result.name}\nTitle: ${result.title}\nURL: ${apiUrl}/dataset/${result.name}`
					}]
				};
			}
		);

		// Update organization tool
		this.server.tool(
			"update_organization",
			"Update an existing organization's details",
			{
				id: z.string().describe("ID or name of the organization to update"),
				title: z.string().optional().describe("New display name for the organization"),
				description: z.string().optional().describe("New description for the organization")
			},
			async ({ id, title, description }) => {
				const apiUrl = this.getApiUrl();

				if (!this.state.apiKey) {
					return {
						content: [{
							type: "text",
							text: `Authentication required.\n\nPlease set your API key first.`
						}]
					};
				}

				const endpoint = `${apiUrl}/api/3/action/organization_patch`;

				const requestBody: any = { id };
				if (title) requestBody.title = title;
				if (description) requestBody.description = description;

				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Authorization": this.state.apiKey,
						"User-Agent": "MCP-PortalJS-Server/1.0"
					},
					body: JSON.stringify(requestBody)
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
							text: `❌ Error updating organization:\n${JSON.stringify(data.error)}`
						}]
					};
				}

				const result = data.result;

				return {
					content: [{
						type: "text",
						text: `✅ Organization updated successfully!\n\nName: ${result.name}\nTitle: ${result.title}`
					}]
				};
			}
		);

		// Get dataset statistics tool
		this.server.tool(
			"get_dataset_stats",
			"Get quick statistics about a dataset including number of resources, total size, last update time, and format types",
			{
				id: z.string().describe("ID or name of the dataset")
			},
			async ({ id }) => {
				const apiUrl = this.getApiUrl();
				const endpoint = `${apiUrl}/api/3/action/package_show?id=${encodeURIComponent(id)}`;

				const response = await fetch(endpoint);
				const data = await response.json();

				if (!data.success || !data.result) {
					return {
						content: [{
							type: "text",
							text: `Error: Dataset not found or invalid ID`
						}]
					};
				}

				const pkg = data.result;
				const resources = pkg.resources || [];
				const formats = [...new Set(resources.map((r: any) => r.format).filter(Boolean))];
				const totalSize = resources.reduce((sum: number, r: any) => sum + (r.size || 0), 0);

				const stats = {
					name: pkg.name,
					title: pkg.title,
					organization: pkg.organization?.title || "None",
					resource_count: resources.length,
					formats: formats,
					total_size_bytes: totalSize,
					total_size_human: totalSize > 0 ? `${(totalSize / 1024 / 1024).toFixed(2)} MB` : "Unknown",
					last_modified: pkg.metadata_modified,
					created: pkg.metadata_created,
					views: pkg.tracking_summary?.total || 0,
					tags: pkg.tags?.map((t: any) => t.name) || []
				};

				return {
					content: [{
						type: "text",
						text: JSON.stringify(stats, null, 2)
					}]
				};
			}
		);

		// Preview resource data
		this.server.tool(
			"preview_resource",
			"Preview the first few rows of a CSV or JSON resource to understand its structure and sample data",
			{
				resource_id: z.string().describe("ID of the resource to preview"),
				limit: z.number().optional().default(5).describe("Number of rows to preview (default: 5, max: 100)")
			},
			async ({ resource_id, limit }) => {
				const apiUrl = this.getApiUrl();
				const maxLimit = Math.min(limit, 100);
				const endpoint = `${apiUrl}/api/3/action/datastore_search?resource_id=${encodeURIComponent(resource_id)}&limit=${maxLimit}`;

				const response = await fetch(endpoint);
				const data = await response.json();

				if (!data.success) {
					return {
						content: [{
							type: "text",
							text: `❌ Cannot preview this resource. It may not be in the DataStore or may not support previews.\n\nTry using 'fetch' tool to see the resource URL and download it manually.`
						}]
					};
				}

				const records = data.result.records;
				const fields = data.result.fields?.map((f: any) => ({ name: f.id, type: f.type })) || [];

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							schema: fields,
							total_records: data.result.total,
							preview_rows: records.length,
							sample_data: records
						}, null, 2)
					}]
				};
			}
		);

		// Get related datasets
		this.server.tool(
			"get_related_datasets",
			"Discover datasets related to a given dataset - either from the same organization or with similar tags",
			{
				id: z.string().describe("ID or name of the reference dataset"),
				relation_type: z.enum(["organization", "tags", "both"]).optional().default("both").describe("How to find related datasets")
			},
			async ({ id, relation_type }) => {
				const apiUrl = this.getApiUrl();

				const sourceEndpoint = `${apiUrl}/api/3/action/package_show?id=${encodeURIComponent(id)}`;
				const sourceResponse = await fetch(sourceEndpoint);
				const sourceData = await sourceResponse.json();

				if (!sourceData.success || !sourceData.result) {
					return {
						content: [{
							type: "text",
							text: `Error: Source dataset not found`
						}]
					};
				}

				const source = sourceData.result;
				const relatedDatasets: any[] = [];

				if (relation_type === "organization" || relation_type === "both") {
					if (source.organization) {
						const orgEndpoint = `${apiUrl}/api/3/action/package_search?fq=organization:${encodeURIComponent(source.organization.name)}&rows=10`;
						const orgResponse = await fetch(orgEndpoint);
						const orgData = await orgResponse.json();

						if (orgData.success) {
							relatedDatasets.push(...orgData.result.results.filter((d: any) => d.id !== source.id));
						}
					}
				}

				if (relation_type === "tags" || relation_type === "both") {
					if (source.tags && source.tags.length > 0) {
						const tagNames = source.tags.map((t: any) => t.name).slice(0, 3);
						const tagQuery = tagNames.join(" OR ");
						const tagEndpoint = `${apiUrl}/api/3/action/package_search?q=${encodeURIComponent(tagQuery)}&rows=10`;
						const tagResponse = await fetch(tagEndpoint);
						const tagData = await tagResponse.json();

						if (tagData.success) {
							const tagResults = tagData.result.results.filter((d: any) => d.id !== source.id);
							relatedDatasets.push(...tagResults);
						}
					}
				}

				const uniqueDatasets = Array.from(new Map(relatedDatasets.map(d => [d.id, d])).values());

				const results = uniqueDatasets.slice(0, 10).map((d: any) => ({
					name: d.name,
					title: d.title,
					organization: d.organization?.title,
					tags: d.tags?.map((t: any) => t.name).slice(0, 5),
					url: `${apiUrl}/dataset/${d.name}`
				}));

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							source_dataset: source.title,
							relation_type,
							found: results.length,
							related_datasets: results
						}, null, 2)
					}]
				};
			}
		);

		// Get organization details
		this.server.tool(
			"get_organization_details",
			"Get detailed information about an organization including description, dataset count, and creation date for verifying data reliability",
			{
				id: z.string().describe("ID or name of the organization")
			},
			async ({ id }) => {
				const apiUrl = this.getApiUrl();
				const endpoint = `${apiUrl}/api/3/action/organization_show?id=${encodeURIComponent(id)}&include_datasets=false`;

				const response = await fetch(endpoint);
				const data = await response.json();

				if (!data.success || !data.result) {
					return {
						content: [{
							type: "text",
							text: `Error: Organization not found`
						}]
					};
				}

				const org = data.result;

				const details = {
					name: org.name,
					title: org.title || org.display_name,
					description: org.description,
					created: org.created,
					dataset_count: org.package_count,
					image_url: org.image_url,
					url: `${apiUrl}/organization/${org.name}`,
					type: org.type,
					state: org.state
				};

				return {
					content: [{
						type: "text",
						text: JSON.stringify(details, null, 2)
					}]
				};
			}
		);

		// Compare datasets
		this.server.tool(
			"compare_datasets",
			"Compare metadata of multiple datasets side-by-side to help choose the best option for your needs",
			{
				dataset_ids: z.array(z.string()).describe("Array of dataset IDs or names to compare (max 5)")
			},
			async ({ dataset_ids }) => {
				const apiUrl = this.getApiUrl();
				const idsToCompare = dataset_ids.slice(0, 5);

				const comparisons = await Promise.all(
					idsToCompare.map(async (id) => {
						const endpoint = `${apiUrl}/api/3/action/package_show?id=${encodeURIComponent(id)}`;
						const response = await fetch(endpoint);
						const data = await response.json();

						if (!data.success || !data.result) {
							return { id, error: "Not found" };
						}

						const pkg = data.result;
						return {
							name: pkg.name,
							title: pkg.title,
							organization: pkg.organization?.title || "None",
							created: pkg.metadata_created,
							last_modified: pkg.metadata_modified,
							resource_count: pkg.resources?.length || 0,
							formats: [...new Set(pkg.resources?.map((r: any) => r.format).filter(Boolean))],
							tags: pkg.tags?.map((t: any) => t.name) || [],
							license: pkg.license_title,
							private: pkg.private,
							url: `${apiUrl}/dataset/${pkg.name}`
						};
					})
				);

				return {
					content: [{
						type: "text",
						text: JSON.stringify({ comparison: comparisons }, null, 2)
					}]
				};
			}
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
