import type { CloudRegion } from '../types/oauth';

export const POSTHOG_US_CLIENT_ID = 'c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM';
export const POSTHOG_EU_CLIENT_ID = 'bx2C5sZRN03TkdjraCcetvQFPGH6N2Y9vRLkcKEy';
export const POSTHOG_DEV_CLIENT_ID = 'DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ';

export const OAUTH_PORT = 8239;

export const OAUTH_SCOPES = [
  'user:read',
  'project:read',
  'task:write',
  'integration:read'
];

// Token refresh settings
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

export function getCloudUrlFromRegion(region: CloudRegion): string {
  switch (region) {
    case 'us':
      return 'https://us.posthog.com';
    case 'eu':
      return 'https://eu.posthog.com';
    case 'dev':
      return 'http://localhost:8000';
  }
}

export function getOauthClientIdFromRegion(region: CloudRegion): string {
  switch (region) {
    case 'us':
      return POSTHOG_US_CLIENT_ID;
    case 'eu':
      return POSTHOG_EU_CLIENT_ID;
    case 'dev':
      return POSTHOG_DEV_CLIENT_ID;
  }
}
