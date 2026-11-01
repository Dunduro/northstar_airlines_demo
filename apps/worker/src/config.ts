export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://northstar:northstar@localhost:54329/northstar',
  /** Mock receivers stand in for Teams, ServiceNow and the GitHub API. */
  teamsWebhookBase: process.env.TEAMS_WEBHOOK_BASE ?? 'http://localhost:4000/teams/webhook',
  serviceNowUrl: process.env.SERVICENOW_URL ?? 'http://localhost:4000/servicenow',
  githubApiUrl: process.env.GITHUB_API_URL ?? 'http://localhost:4000/github',
  githubRepo: process.env.GITHUB_REPO ?? 'northstar/landing-zone',
  dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
};
